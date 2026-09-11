-- ============================================================================
-- payCcount 0006: 加盟店 / 決済 API / Checkout / 返金 / Webhook
--
-- 決済 (execute_payment) は 1 トランザクションで:
--   ユーザー口座（source）減算 → 異通貨なら fx_pool / crypto_custody 経由で精算通貨に換算（スプレッド込み）
--   → 加盟店口座に settlement - fee、fee_revenue に fee → payments / checkout_sessions 更新 → Webhook キュー
-- 返金は元の支払ソース通貨で、決済時のレート（按分）で戻す。差額はプール勘定が吸収する。
-- ============================================================================
set client_min_messages = warning;

-- ───────────────────────── 加盟店 ─────────────────────────
create table if not exists merchants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  country             text not null default 'JP',
  settlement_currency text not null references currencies(code),
  owner_user_id       uuid not null references profiles(user_id) on delete cascade,
  website_url         text,
  fee_bps             int,                       -- null なら config.merchant_fee_bps
  created_at          timestamptz not null default now()
);
create index if not exists merchants_owner_idx on merchants (owner_user_id);

create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  prefix       text not null,                    -- 表示用（先頭 12 文字）
  key_hash     text not null unique,             -- SHA-256(平文キー)
  mode         text not null default 'test' check (mode in ('test')),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists api_keys_merchant_idx on api_keys (merchant_id);

create table if not exists checkout_sessions (
  id               text primary key,
  merchant_id      uuid not null references merchants(id) on delete cascade,
  amount           numeric(40,0) not null check (amount > 0),
  currency         text not null references currencies(code),
  order_id         text,
  description      text,
  success_url      text not null,
  cancel_url       text not null,
  accepted_sources text[] not null,
  metadata         jsonb not null default '{}'::jsonb,
  status           text not null default 'open' check (status in ('open','completed','expired','canceled')),
  expires_at       timestamptz not null,
  payment_id       text,
  idempotency_key  text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (merchant_id, idempotency_key)
);
create index if not exists checkout_sessions_merchant_idx on checkout_sessions (merchant_id, created_at desc);
create index if not exists checkout_sessions_open_idx on checkout_sessions (expires_at) where status = 'open';

create table if not exists payments (
  id                     text primary key,
  merchant_id            uuid not null references merchants(id) on delete cascade,
  session_id             text not null references checkout_sessions(id),
  payer_user_id          uuid not null references profiles(user_id),
  source_currency        text not null references currencies(code),
  source_amount          numeric(40,0) not null,
  settlement_currency    text not null references currencies(code),
  settlement_amount      numeric(40,0) not null,
  fx_rate                numeric(30,12) not null,   -- 1 source = fx_rate settlement（実効）
  mid_rate               numeric(30,12) not null,
  spread_bps             int not null default 0,
  fee_amount             numeric(40,0) not null,
  fee_bps                int not null,
  net_amount             numeric(40,0) not null,
  status                 text not null default 'succeeded' check (status in ('succeeded','refunded','partially_refunded')),
  refunded_amount        numeric(40,0) not null default 0,
  refunded_source_amount numeric(40,0) not null default 0,
  order_id               text,
  description            text,
  metadata               jsonb not null default '{}'::jsonb,
  journal_id             uuid references journal_entries(id),
  created_at             timestamptz not null default now()
);
create index if not exists payments_merchant_idx on payments (merchant_id, created_at desc, id desc);
create index if not exists payments_payer_idx on payments (payer_user_id, created_at desc);

create table if not exists refunds (
  id              text primary key,
  payment_id      text not null references payments(id),
  merchant_id     uuid not null references merchants(id),
  amount          numeric(40,0) not null check (amount > 0),   -- 精算通貨
  currency        text not null,
  source_amount   numeric(40,0) not null,                     -- ユーザーに戻した支払ソース通貨の額
  source_currency text not null,
  reason          text,
  status          text not null default 'succeeded',
  idempotency_key text,
  journal_id      uuid references journal_entries(id),
  created_at      timestamptz not null default now(),
  unique (merchant_id, idempotency_key)
);
create index if not exists refunds_payment_idx on refunds (payment_id);

create table if not exists webhook_endpoints (
  id          text primary key,
  merchant_id uuid not null references merchants(id) on delete cascade,
  url         text not null,
  secret      text not null,
  events      text[] not null default array['*'],
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists webhook_endpoints_merchant_idx on webhook_endpoints (merchant_id);

create table if not exists webhook_events (
  id          text primary key,
  merchant_id uuid not null references merchants(id) on delete cascade,
  type        text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists webhook_events_merchant_idx on webhook_events (merchant_id, created_at desc, id desc);

create table if not exists webhook_deliveries (
  id                 text primary key,
  event_id           text not null references webhook_events(id) on delete cascade,
  endpoint_id        text not null references webhook_endpoints(id) on delete cascade,
  merchant_id        uuid not null references merchants(id) on delete cascade,
  status             text not null default 'pending' check (status in ('pending','in_flight','delivered','failed')),
  attempts           int not null default 0,
  next_retry_at      timestamptz,
  last_status_code   int,
  last_response_body text,
  last_error         text,
  delivered_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists webhook_deliveries_due_idx on webhook_deliveries (next_retry_at) where status in ('pending','in_flight');
create index if not exists webhook_deliveries_event_idx on webhook_deliveries (event_id);

create table if not exists idempotency_keys (
  merchant_id   uuid not null references merchants(id) on delete cascade,
  key           text not null,
  request_hash  text not null,
  status_code   int not null,
  response_body jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (merchant_id, key)
);

create table if not exists api_rate_limits (
  api_key_id   uuid not null references api_keys(id) on delete cascade,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (api_key_id, window_start)
);

create table if not exists api_request_logs (
  id          bigserial primary key,
  merchant_id uuid references merchants(id) on delete cascade,
  api_key_id  uuid,
  method      text not null,
  path        text not null,
  status_code int not null,
  duration_ms int not null,
  request_id  text,
  created_at  timestamptz not null default now()
);
create index if not exists api_request_logs_merchant_idx on api_request_logs (merchant_id, created_at desc);

create table if not exists audit_logs (
  id          bigserial primary key,
  actor_type  text not null,     -- 'user' | 'merchant' | 'api_key' | 'system' | 'admin'
  actor_id    text,
  action      text not null,
  target_type text,
  target_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);

-- ───────────────────────── JSON ─────────────────────────
create or replace function merchant_json(m merchants) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'name', m.name, 'country', m.country, 'settlement_currency', m.settlement_currency,
    'owner_user_id', m.owner_user_id, 'website_url', m.website_url,
    'fee_bps', coalesce(m.fee_bps, cfg_int('merchant_fee_bps', 160)), 'created_at', m.created_at
  )
$$;

create or replace function api_key_json(k api_keys) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', k.id, 'merchant_id', k.merchant_id, 'prefix', k.prefix, 'mode', k.mode,
    'last_used_at', k.last_used_at, 'revoked_at', k.revoked_at, 'created_at', k.created_at
  )
$$;

create or replace function checkout_session_json(s checkout_sessions, p_app_url text default null) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', s.id, 'object', 'checkout.session', 'merchant_id', s.merchant_id, 'status', s.status,
    'url', coalesce(p_app_url, '') || '/checkout/' || s.id,
    'amount', s.amount::text, 'currency', s.currency, 'order_id', s.order_id, 'description', s.description,
    'success_url', s.success_url, 'cancel_url', s.cancel_url,
    'accepted_sources', to_jsonb(s.accepted_sources), 'metadata', s.metadata,
    'payment_id', s.payment_id, 'expires_at', s.expires_at, 'created_at', s.created_at, 'completed_at', s.completed_at,
    'demo', true
  )
$$;

create or replace function payment_json(p payments) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p.id, 'object', 'payment', 'merchant_id', p.merchant_id, 'session_id', p.session_id,
    'order_id', p.order_id, 'description', p.description,
    'source_currency', p.source_currency, 'source_amount', p.source_amount::text,
    'settlement_currency', p.settlement_currency, 'settlement_amount', p.settlement_amount::text,
    'fx_rate', trim_scale(p.fx_rate)::text, 'mid_rate', trim_scale(p.mid_rate)::text, 'spread_bps', p.spread_bps,
    'fee_amount', p.fee_amount::text, 'fee_bps', p.fee_bps, 'net_amount', p.net_amount::text,
    'status', p.status, 'refunded_amount', p.refunded_amount::text, 'refunded_source_amount', p.refunded_source_amount::text,
    'metadata', p.metadata, 'created_at', p.created_at, 'demo', true
  )
$$;

create or replace function refund_json(r refunds) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', r.id, 'object', 'refund', 'payment_id', r.payment_id, 'amount', r.amount::text, 'currency', r.currency,
    'source_amount', r.source_amount::text, 'source_currency', r.source_currency,
    'reason', r.reason, 'status', r.status, 'created_at', r.created_at, 'demo', true
  )
$$;

create or replace function webhook_endpoint_json(e webhook_endpoints) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', e.id, 'object', 'webhook_endpoint', 'merchant_id', e.merchant_id, 'url', e.url,
    'events', to_jsonb(e.events), 'enabled', e.enabled, 'created_at', e.created_at
  )
$$;

create or replace function webhook_delivery_json(d webhook_deliveries) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', d.id, 'event_id', d.event_id, 'endpoint_id', d.endpoint_id,
    'url', (select url from webhook_endpoints where id = d.endpoint_id),
    'status', d.status, 'attempts', d.attempts, 'next_retry_at', d.next_retry_at,
    'last_status_code', d.last_status_code, 'last_response_body', d.last_response_body, 'last_error', d.last_error,
    'delivered_at', d.delivered_at, 'created_at', d.created_at
  )
$$;

create or replace function webhook_event_json(e webhook_events, p_with_deliveries boolean default true) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'object', 'event', 'type', e.type, 'created', extract(epoch from e.created_at)::bigint,
    'created_at', e.created_at, 'demo', true, 'data', jsonb_build_object('object', e.payload)
  ) || case when p_with_deliveries then jsonb_build_object('deliveries', coalesce((
    select jsonb_agg(webhook_delivery_json(d.*) order by d.created_at) from webhook_deliveries d where d.event_id = e.id
  ), '[]'::jsonb)) else '{}'::jsonb end
$$;

-- ───────────────────────── 加盟店 CRUD ─────────────────────────
create or replace function assert_merchant_owner(p_merchant_id uuid, p_user_id uuid) returns merchants
language plpgsql stable security definer set search_path = public as $$
declare
  v_m merchants%rowtype;
  v_role text;
begin
  select * into v_m from merchants where id = p_merchant_id;
  if not found then perform app_error('merchant_not_found', '加盟店が見つかりません'); end if;
  if v_m.owner_user_id <> p_user_id then
    select role into v_role from profiles where user_id = p_user_id;
    if coalesce(v_role, '') <> 'admin' then
      perform app_error('forbidden', 'この加盟店を操作する権限がありません');
    end if;
  end if;
  return v_m;
end $$;

create or replace function create_merchant(p_owner_user_id uuid, p_name text, p_country text, p_settlement_currency text, p_website_url text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m merchants%rowtype;
begin
  if p_name is null or length(trim(p_name)) = 0 then perform app_error('invalid_request', '店舗名が必要です', 'name'); end if;
  if not exists (select 1 from currencies where code = p_settlement_currency and kind = 'fiat') then
    perform app_error('invalid_currency', '精算通貨は法定通貨（JPY/USD/EUR/GBP）から選んでください', 'settlement_currency');
  end if;
  insert into merchants (name, country, settlement_currency, owner_user_id, website_url)
  values (trim(p_name), upper(coalesce(nullif(p_country, ''), 'JP')), p_settlement_currency, p_owner_user_id, nullif(p_website_url, ''))
  returning * into v_m;
  perform ensure_account('merchant', v_m.id, null, p_settlement_currency);
  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('user', p_owner_user_id::text, 'merchant.create', 'merchant', v_m.id::text, jsonb_build_object('name', v_m.name));
  return merchant_json(v_m);
end $$;

create or replace function list_my_merchants(p_user_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(merchant_json(m.*) order by m.created_at) from merchants m where m.owner_user_id = p_user_id
  ), '[]'::jsonb))
$$;

create or replace function get_merchant(p_merchant_id uuid, p_user_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select merchant_json(assert_merchant_owner(p_merchant_id, p_user_id))
$$;

create or replace function update_merchant(p_merchant_id uuid, p_user_id uuid, p_name text, p_country text, p_settlement_currency text, p_website_url text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m merchants%rowtype := assert_merchant_owner(p_merchant_id, p_user_id);
begin
  if p_settlement_currency is not null and p_settlement_currency <> v_m.settlement_currency then
    if not exists (select 1 from currencies where code = p_settlement_currency and kind = 'fiat') then
      perform app_error('invalid_currency', '精算通貨は法定通貨から選んでください', 'settlement_currency');
    end if;
    if exists (select 1 from payments where merchant_id = p_merchant_id) then
      perform app_error('settlement_currency_locked', '決済実績がある加盟店の精算通貨は変更できません', 'settlement_currency');
    end if;
    perform ensure_account('merchant', p_merchant_id, null, p_settlement_currency);
  end if;
  update merchants set
    name = coalesce(nullif(trim(p_name), ''), name),
    country = coalesce(upper(nullif(p_country, '')), country),
    settlement_currency = coalesce(p_settlement_currency, settlement_currency),
    website_url = case when p_website_url is null then website_url else nullif(p_website_url, '') end
  where id = p_merchant_id returning * into v_m;
  return merchant_json(v_m);
end $$;

-- ───────────────────────── APIキー ─────────────────────────
-- 平文キーは発行時に一度だけ返す。DB には SHA-256 のみ保存
create or replace function create_api_key(p_merchant_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text := 'sk_test_' || encode(gen_random_bytes(24), 'hex');
  v_k api_keys%rowtype;
begin
  perform assert_merchant_owner(p_merchant_id, p_user_id);
  insert into api_keys (merchant_id, prefix, key_hash)
  values (p_merchant_id, substr(v_key, 1, 12) || '…' || substr(v_key, length(v_key) - 3), encode(digest(v_key, 'sha256'), 'hex'))
  returning * into v_k;
  insert into audit_logs (actor_type, actor_id, action, target_type, target_id)
  values ('user', p_user_id::text, 'api_key.create', 'api_key', v_k.id::text);
  return api_key_json(v_k) || jsonb_build_object('key', v_key);
end $$;

create or replace function list_api_keys(p_merchant_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_merchant_owner(p_merchant_id, p_user_id);
  return jsonb_build_object('data', coalesce((
    select jsonb_agg(api_key_json(k.*) order by k.created_at desc) from api_keys k where k.merchant_id = p_merchant_id
  ), '[]'::jsonb));
end $$;

create or replace function revoke_api_key(p_merchant_id uuid, p_user_id uuid, p_key_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_k api_keys%rowtype;
begin
  perform assert_merchant_owner(p_merchant_id, p_user_id);
  update api_keys set revoked_at = coalesce(revoked_at, now()) where id = p_key_id and merchant_id = p_merchant_id returning * into v_k;
  if not found then perform app_error('api_key_not_found', 'APIキーが見つかりません'); end if;
  insert into audit_logs (actor_type, actor_id, action, target_type, target_id)
  values ('user', p_user_id::text, 'api_key.revoke', 'api_key', v_k.id::text);
  return api_key_json(v_k);
end $$;

-- APIキー認証（ハッシュで照合）
create or replace function authenticate_api_key(p_key_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_k api_keys%rowtype;
  v_m merchants%rowtype;
begin
  select * into v_k from api_keys where key_hash = p_key_hash;
  if not found or v_k.revoked_at is not null then
    perform app_error('invalid_api_key', 'APIキーが無効です');
  end if;
  update api_keys set last_used_at = now() where id = v_k.id;
  select * into v_m from merchants where id = v_k.merchant_id;
  return jsonb_build_object('api_key_id', v_k.id, 'merchant', merchant_json(v_m));
end $$;

-- レート制限（固定ウィンドウ）: インクリメントして現在のカウントを返す
create or replace function bump_rate_limit(p_api_key_id uuid, p_window_start timestamptz) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  insert into api_rate_limits (api_key_id, window_start, count) values (p_api_key_id, p_window_start, 1)
  on conflict (api_key_id, window_start) do update set count = api_rate_limits.count + 1
  returning count into v_count;
  -- 古いウィンドウを間引く
  delete from api_rate_limits where api_key_id = p_api_key_id and window_start < p_window_start - interval '10 minutes';
  return v_count;
end $$;

-- 冪等キー
create or replace function idempotency_lookup(p_merchant_id uuid, p_key text) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('request_hash', k.request_hash, 'status_code', k.status_code, 'response_body', k.response_body)
  from idempotency_keys k where k.merchant_id = p_merchant_id and k.key = p_key
$$;

create or replace function idempotency_store(p_merchant_id uuid, p_key text, p_request_hash text, p_status_code int, p_response_body jsonb) returns void
language sql security definer set search_path = public as $$
  insert into idempotency_keys (merchant_id, key, request_hash, status_code, response_body)
  values (p_merchant_id, p_key, p_request_hash, p_status_code, p_response_body)
  on conflict (merchant_id, key) do nothing
$$;

create or replace function log_api_request(p_merchant_id uuid, p_api_key_id uuid, p_method text, p_path text, p_status_code int, p_duration_ms int, p_request_id text) returns void
language sql security definer set search_path = public as $$
  insert into api_request_logs (merchant_id, api_key_id, method, path, status_code, duration_ms, request_id)
  values (p_merchant_id, p_api_key_id, p_method, p_path, p_status_code, p_duration_ms, p_request_id)
$$;

create or replace function list_api_request_logs(p_merchant_id uuid, p_user_id uuid, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform assert_merchant_owner(p_merchant_id, p_user_id);
  return jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'merchant_id', l.merchant_id, 'api_key_id', l.api_key_id, 'method', l.method, 'path', l.path,
                                        'status_code', l.status_code, 'duration_ms', l.duration_ms, 'request_id', l.request_id, 'created_at', l.created_at)
                     order by l.created_at desc, l.id desc)
    from (select * from api_request_logs where merchant_id = p_merchant_id order by created_at desc, id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) l
  ), '[]'::jsonb));
end $$;

-- ───────────────────────── Webhook キュー ─────────────────────────
create or replace function enqueue_webhook_event(p_merchant_id uuid, p_type text, p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_event_id text := gen_prefixed_id('evt_');
  v_e webhook_endpoints%rowtype;
begin
  insert into webhook_events (id, merchant_id, type, payload) values (v_event_id, p_merchant_id, p_type, p_payload);
  for v_e in select * from webhook_endpoints where merchant_id = p_merchant_id and enabled and deleted_at is null
             and ('*' = any(events) or p_type = any(events)) loop
    insert into webhook_deliveries (id, event_id, endpoint_id, merchant_id, status, attempts, next_retry_at)
    values (gen_prefixed_id('whd_'), v_event_id, v_e.id, p_merchant_id, 'pending', 0, now());
  end loop;
  return v_event_id;
end $$;

create or replace function create_webhook_endpoint(p_merchant_id uuid, p_url text, p_events text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_e webhook_endpoints%rowtype;
  v_secret text := 'whsec_' || encode(gen_random_bytes(24), 'hex');
  v_events text[] := coalesce(p_events, array['*']);
  v_allowed text[] := array['*','checkout.session.completed','checkout.session.expired','payment.succeeded','payment.refunded','payout.paid'];
begin
  if p_url is null or p_url !~ '^https?://' then perform app_error('invalid_url', 'url は http(s):// で始まる必要があります', 'url'); end if;
  if exists (select 1 from unnest(v_events) ev where not (ev = any(v_allowed))) then
    perform app_error('invalid_event_type', '未対応のイベント種別が含まれています', 'events');
  end if;
  if (select count(*) from webhook_endpoints where merchant_id = p_merchant_id and deleted_at is null) >= 10 then
    perform app_error('too_many_endpoints', 'Webhook エンドポイントは 10 件までです', 'url');
  end if;
  insert into webhook_endpoints (id, merchant_id, url, secret, events) values (gen_prefixed_id('wh_'), p_merchant_id, p_url, v_secret, v_events)
  returning * into v_e;
  return webhook_endpoint_json(v_e) || jsonb_build_object('secret', v_secret);
end $$;

create or replace function list_webhook_endpoints(p_merchant_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(webhook_endpoint_json(e.*) order by e.created_at) from webhook_endpoints e where e.merchant_id = p_merchant_id and e.deleted_at is null
  ), '[]'::jsonb), 'has_more', false)
$$;

create or replace function delete_webhook_endpoint(p_merchant_id uuid, p_endpoint_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_e webhook_endpoints%rowtype;
begin
  update webhook_endpoints set deleted_at = now(), enabled = false where id = p_endpoint_id and merchant_id = p_merchant_id and deleted_at is null returning * into v_e;
  if not found then perform app_error('endpoint_not_found', 'Webhook エンドポイントが見つかりません'); end if;
  update webhook_deliveries set status = 'failed', last_error = 'endpoint deleted', updated_at = now() where endpoint_id = v_e.id and status in ('pending','in_flight');
  return jsonb_build_object('id', v_e.id, 'object', 'webhook_endpoint', 'deleted', true);
end $$;

create or replace function list_webhook_events(p_merchant_id uuid, p_limit int default 20, p_starting_after text default null, p_type text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_cursor webhook_events%rowtype;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then
    select * into v_cursor from webhook_events where id = p_starting_after and merchant_id = p_merchant_id;
  end if;
  with rows as (
    select e.* from webhook_events e
    where e.merchant_id = p_merchant_id
      and (p_type is null or e.type = p_type)
      and (v_cursor.id is null or (e.created_at, e.id) < (v_cursor.created_at, v_cursor.id))
    order by e.created_at desc, e.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(webhook_event_json(rows.*, true) order by rows.created_at desc, rows.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from rows;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;
  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

create or replace function get_webhook_event(p_merchant_id uuid, p_event_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_e webhook_events%rowtype;
begin
  select * into v_e from webhook_events where id = p_event_id and merchant_id = p_merchant_id;
  if not found then perform app_error('event_not_found', 'イベントが見つかりません'); end if;
  return webhook_event_json(v_e, true);
end $$;

-- 再送: 有効なエンドポイントすべてに新しい配信を作る（履歴は残す）
create or replace function resend_webhook_event(p_merchant_id uuid, p_event_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_e webhook_events%rowtype;
  v_ep webhook_endpoints%rowtype;
  v_n int := 0;
begin
  select * into v_e from webhook_events where id = p_event_id and merchant_id = p_merchant_id;
  if not found then perform app_error('event_not_found', 'イベントが見つかりません'); end if;
  for v_ep in select * from webhook_endpoints where merchant_id = p_merchant_id and enabled and deleted_at is null
              and ('*' = any(events) or v_e.type = any(events)) loop
    insert into webhook_deliveries (id, event_id, endpoint_id, merchant_id, status, attempts, next_retry_at)
    values (gen_prefixed_id('whd_'), v_e.id, v_ep.id, p_merchant_id, 'pending', 0, now());
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then perform app_error('no_endpoints', '配信先の Webhook エンドポイントがありません'); end if;
  return webhook_event_json(v_e, true) || jsonb_build_object('resent', v_n);
end $$;

-- 配信ワーカー: 期限が来た配信を取り出して in_flight にする（skip locked で多重実行に耐える）
create or replace function claim_webhook_deliveries(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
begin
  with due as (
    select d.id from webhook_deliveries d
    where d.status = 'pending' and d.next_retry_at <= now()
    order by d.next_retry_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  ),
  claimed as (
    update webhook_deliveries d set status = 'in_flight', updated_at = now()
    from due where d.id = due.id
    returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', c.id, 'event_id', c.event_id, 'endpoint_id', c.endpoint_id, 'attempts', c.attempts,
    'url', e.url, 'secret', e.secret,
    'event', webhook_event_json(ev.*, false)
  )), '[]'::jsonb)
  into v_rows
  from claimed c
  join webhook_endpoints e on e.id = c.endpoint_id
  join webhook_events ev on ev.id = c.event_id;
  return v_rows;
end $$;

-- 配信結果の記録。失敗時は 1分, 5分, 30分, 2時間, 12時間 で最大 5 回
create or replace function record_webhook_delivery(p_delivery_id text, p_success boolean, p_status_code int, p_response_body text, p_error text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d webhook_deliveries%rowtype;
  v_attempts int;
  v_delay interval;
begin
  select * into v_d from webhook_deliveries where id = p_delivery_id for update;
  if not found then perform app_error('not_found', '配信が見つかりません'); end if;
  v_attempts := v_d.attempts + 1;
  if p_success then
    update webhook_deliveries set status = 'delivered', attempts = v_attempts, last_status_code = p_status_code,
      last_response_body = left(coalesce(p_response_body, ''), 1024), last_error = null, delivered_at = now(), next_retry_at = null, updated_at = now()
    where id = p_delivery_id returning * into v_d;
  else
    v_delay := case v_attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes'
                                when 4 then interval '2 hours' else interval '12 hours' end;
    update webhook_deliveries set
      status = case when v_attempts >= 5 then 'failed' else 'pending' end,
      attempts = v_attempts,
      last_status_code = p_status_code,
      last_response_body = left(coalesce(p_response_body, ''), 1024),
      last_error = left(coalesce(p_error, ''), 500),
      next_retry_at = case when v_attempts >= 5 then null else now() + v_delay end,
      updated_at = now()
    where id = p_delivery_id returning * into v_d;
  end if;
  return webhook_delivery_json(v_d);
end $$;

-- 取り残された in_flight（ワーカー落ち）を pending に戻す
create or replace function requeue_stale_webhook_deliveries() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update webhook_deliveries set status = 'pending', next_retry_at = now(), updated_at = now()
  where status = 'in_flight' and updated_at < now() - interval '5 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── Checkout Session ─────────────────────────
create or replace function create_checkout_session(
  p_merchant_id      uuid,
  p_amount           numeric,
  p_currency         text,
  p_order_id         text,
  p_description      text,
  p_success_url      text,
  p_cancel_url       text,
  p_accepted_sources text[] default null,
  p_metadata         jsonb default '{}'::jsonb,
  p_idempotency_key  text default null,
  p_app_url          text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m merchants%rowtype;
  v_s checkout_sessions%rowtype;
  v_sources text[] := coalesce(p_accepted_sources, array['JPY','PT','USD','EUR','GBP','BTC','ETH']);
  v_ttl int := cfg_int('checkout_session_ttl_minutes', 30);
begin
  select * into v_m from merchants where id = p_merchant_id;
  if not found then perform app_error('merchant_not_found', '加盟店が見つかりません'); end if;

  if p_idempotency_key is not null then
    select * into v_s from checkout_sessions where merchant_id = p_merchant_id and idempotency_key = p_idempotency_key;
    if found then return checkout_session_json(v_s, p_app_url); end if;
  end if;

  if p_amount is null or p_amount <= 0 or scale(p_amount) <> 0 then
    perform app_error('invalid_amount', 'amount は最小単位の正の整数文字列で指定してください', 'amount');
  end if;
  if p_currency is distinct from v_m.settlement_currency then
    perform app_error('currency_not_supported', 'currency は加盟店の精算通貨（' || v_m.settlement_currency || '）と一致させてください', 'currency');
  end if;
  if p_success_url is null or p_success_url !~ '^https?://' then perform app_error('invalid_url', 'success_url は http(s):// で始まる必要があります', 'success_url'); end if;
  if p_cancel_url is null or p_cancel_url !~ '^https?://' then perform app_error('invalid_url', 'cancel_url は http(s):// で始まる必要があります', 'cancel_url'); end if;
  if array_length(v_sources, 1) is null then perform app_error('invalid_request', 'accepted_sources が空です', 'accepted_sources'); end if;
  if exists (select 1 from unnest(v_sources) s where not exists (select 1 from currencies where code = s)) then
    perform app_error('invalid_currency', 'accepted_sources に未対応の通貨が含まれています', 'accepted_sources');
  end if;

  insert into checkout_sessions (id, merchant_id, amount, currency, order_id, description, success_url, cancel_url, accepted_sources, metadata, expires_at, idempotency_key)
  values (gen_prefixed_id('cs_'), p_merchant_id, p_amount, p_currency, p_order_id, p_description, p_success_url, p_cancel_url, v_sources,
          coalesce(p_metadata, '{}'::jsonb), now() + make_interval(mins => v_ttl), p_idempotency_key)
  returning * into v_s;
  return checkout_session_json(v_s, p_app_url);
end $$;

-- 期限切れなら expired にして Webhook を出す（遅延評価）
create or replace function touch_checkout_session(p_session checkout_sessions) returns checkout_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype := p_session;
begin
  if v_s.status = 'open' and v_s.expires_at < now() then
    update checkout_sessions set status = 'expired' where id = v_s.id and status = 'open' returning * into v_s;
    if found then
      perform enqueue_webhook_event(v_s.merchant_id, 'checkout.session.expired', checkout_session_json(v_s, null));
    end if;
  end if;
  return v_s;
end $$;

create or replace function get_checkout_session(p_session_id text, p_merchant_id uuid default null, p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype;
begin
  select * into v_s from checkout_sessions where id = p_session_id and (p_merchant_id is null or merchant_id = p_merchant_id);
  if not found then perform app_error('session_not_found', 'Checkout Session が見つかりません'); end if;
  v_s := touch_checkout_session(v_s);
  return checkout_session_json(v_s, p_app_url);
end $$;

create or replace function expire_checkout_session(p_session_id text, p_merchant_id uuid, p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype;
begin
  select * into v_s from checkout_sessions where id = p_session_id and merchant_id = p_merchant_id for update;
  if not found then perform app_error('session_not_found', 'Checkout Session が見つかりません'); end if;
  if v_s.status <> 'open' then
    perform app_error('session_not_open', 'open 状態の Session だけを期限切れにできます（現在: ' || v_s.status || '）');
  end if;
  update checkout_sessions set status = 'expired' where id = v_s.id returning * into v_s;
  perform enqueue_webhook_event(v_s.merchant_id, 'checkout.session.expired', checkout_session_json(v_s, p_app_url));
  return checkout_session_json(v_s, p_app_url);
end $$;

create or replace function cancel_checkout_session_by_user(p_session_id text, p_user_id uuid, p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype;
begin
  select * into v_s from checkout_sessions where id = p_session_id for update;
  if not found then perform app_error('session_not_found', 'Checkout Session が見つかりません'); end if;
  v_s := touch_checkout_session(v_s);
  if v_s.status = 'open' then
    update checkout_sessions set status = 'canceled' where id = v_s.id returning * into v_s;
    insert into audit_logs (actor_type, actor_id, action, target_type, target_id) values ('user', p_user_id::text, 'checkout.cancel', 'checkout_session', v_s.id);
  end if;
  return checkout_session_json(v_s, p_app_url);
end $$;

-- Cron: 期限切れ Session の掃除
create or replace function expire_checkout_sessions() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype;
  v_n int := 0;
begin
  for v_s in select * from checkout_sessions where status = 'open' and expires_at < now() for update skip locked loop
    perform touch_checkout_session(v_s);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ───────────────────────── 支払ソースの換算 ─────────────────────────
-- 精算通貨 p_settlement の p_amount を、p_source で支払う場合の必要額を返す（切り上げ）
--   PT は JPY と等価（スプレッドなし）。異通貨はミッドレート × (1 - スプレッド) の実効レート
--   戻り値: { source_amount, rate, mid_rate, spread_bps, pool }
create or replace function compute_source_amount(p_settlement text, p_amount numeric, p_source text) returns jsonb
language plpgsql stable set search_path = public as $$
declare
  v_eff_source text := case when p_source = 'PT' then 'JPY' else p_source end;
  v_kind text;
  v_mid numeric;
  v_spread int := 0;
  v_rate numeric;
  v_source_amount numeric;
  v_pool text := null;
begin
  if p_source = p_settlement or (p_source = 'PT' and p_settlement = 'JPY') then
    return jsonb_build_object('source_amount', p_amount::text, 'rate', '1', 'mid_rate', '1', 'spread_bps', 0, 'pool', null);
  end if;
  select kind into v_kind from currencies where code = v_eff_source;
  if v_kind is null then perform app_error('invalid_currency', '未対応の通貨です', 'source_currency'); end if;
  v_spread := case when v_kind = 'crypto' then cfg_int('crypto_spread_bps', 100) else cfg_int('fx_spread_bps', 50) end;
  v_pool := case when v_kind = 'crypto' then 'crypto_custody' else 'fx_pool' end;
  v_mid := get_rate(v_eff_source, p_settlement);
  if v_mid is null then perform app_error('rate_not_found', 'レートが見つかりません', 'source_currency'); end if;
  v_rate := v_mid * (1 - v_spread::numeric / 10000);
  -- 1 source = v_rate settlement。必要な source は settlement / rate（切り上げ）
  v_source_amount := convert_minor_div_ceil(p_amount, p_settlement, v_eff_source, v_rate);
  if v_source_amount is null or v_source_amount <= 0 then perform app_error('amount_too_small', '金額が小さすぎます'); end if;
  return jsonb_build_object('source_amount', v_source_amount::text, 'rate', trim_scale(v_rate)::text, 'mid_rate', trim_scale(v_mid)::text,
                            'spread_bps', v_spread, 'pool', v_pool);
end $$;

-- Checkout ページ用: Session + 加盟店 + 支払ソースごとの必要額と残高
create or replace function get_checkout_view(p_session_id text, p_user_id uuid, p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype;
  v_m merchants%rowtype;
  v_sources jsonb := '[]'::jsonb;
  v_src text;
  v_calc jsonb;
  v_balance numeric;
  v_p payments%rowtype;
begin
  select * into v_s from checkout_sessions where id = p_session_id;
  if not found then perform app_error('session_not_found', 'Checkout Session が見つかりません'); end if;
  v_s := touch_checkout_session(v_s);
  select * into v_m from merchants where id = v_s.merchant_id;

  foreach v_src in array v_s.accepted_sources loop
    begin
      v_calc := compute_source_amount(v_s.currency, v_s.amount, v_src);
    exception when others then
      continue;   -- レートが無い通貨はスキップ
    end;
    select coalesce(balance, 0) into v_balance from accounts where owner_type = 'user' and owner_id = p_user_id and currency = v_src;
    v_balance := coalesce(v_balance, 0);
    v_sources := v_sources || jsonb_build_object(
      'currency', v_src,
      'amount', v_calc->>'source_amount',
      'balance', v_balance::text,
      'sufficient', v_balance >= (v_calc->>'source_amount')::numeric,
      'rate', v_calc->>'rate',
      'mid_rate', v_calc->>'mid_rate',
      'spread_bps', (v_calc->>'spread_bps')::int
    );
  end loop;

  if v_s.payment_id is not null then
    select * into v_p from payments where id = v_s.payment_id;
  end if;

  return jsonb_build_object(
    'session', checkout_session_json(v_s, p_app_url),
    'merchant', jsonb_build_object('id', v_m.id, 'name', v_m.name, 'country', v_m.country, 'website_url', v_m.website_url),
    'sources', v_sources,
    'payment', case when v_p.id is null then null else payment_json(v_p) end,
    'is_payer', (v_p.id is not null and v_p.payer_user_id = p_user_id)
  );
end $$;

-- ───────────────────────── 決済実行（見せ場） ─────────────────────────
create or replace function execute_payment(p_session_id text, p_user_id uuid, p_source_currency text, p_app_url text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_s checkout_sessions%rowtype;
  v_m merchants%rowtype;
  v_p payments%rowtype;
  v_calc jsonb;
  v_source_amount numeric;
  v_rate numeric;
  v_mid numeric;
  v_spread int;
  v_pool text;
  v_fee_bps int;
  v_fee numeric;
  v_net numeric;
  v_lines jsonb;
  v_journal uuid;
  v_payment_id text;
begin
  select * into v_s from checkout_sessions where id = p_session_id for update;
  if not found then perform app_error('session_not_found', 'Checkout Session が見つかりません'); end if;
  v_s := touch_checkout_session(v_s);

  -- 冪等: 既に完了していれば既存の決済を返す（同じユーザーのみ）
  if v_s.status = 'completed' then
    select * into v_p from payments where id = v_s.payment_id;
    if v_p.payer_user_id = p_user_id then
      return payment_json(v_p) || jsonb_build_object('session', checkout_session_json(v_s, p_app_url), 'already_completed', true);
    end if;
    perform app_error('session_not_open', 'この Session は既に決済済みです');
  end if;
  if v_s.status = 'expired' then perform app_error('session_expired', 'Checkout Session の有効期限が切れています'); end if;
  if v_s.status <> 'open' then perform app_error('session_not_open', 'この Session は ' || v_s.status || ' のため決済できません'); end if;
  if not (p_source_currency = any(v_s.accepted_sources)) then
    perform app_error('source_not_accepted', 'この加盟店では ' || p_source_currency || ' での支払いは受け付けていません', 'source_currency');
  end if;

  select * into v_m from merchants where id = v_s.merchant_id;
  v_calc := compute_source_amount(v_s.currency, v_s.amount, p_source_currency);
  v_source_amount := (v_calc->>'source_amount')::numeric;
  v_rate := (v_calc->>'rate')::numeric;
  v_mid := (v_calc->>'mid_rate')::numeric;
  v_spread := (v_calc->>'spread_bps')::int;
  v_pool := v_calc->>'pool';

  v_fee_bps := coalesce(v_m.fee_bps, cfg_int('merchant_fee_bps', 160));
  v_fee := floor(v_s.amount * v_fee_bps / 10000);
  v_net := v_s.amount - v_fee;

  -- 仕訳行の組み立て（通貨ごとに合計 0）
  if p_source_currency = v_s.currency then
    v_lines := jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', v_s.currency, 'amount', (-v_s.amount)::text)
    );
  elsif p_source_currency = 'PT' then
    -- PT → JPY は points_issuer が JPY を負担、JPY → 精算通貨は fx_pool
    v_lines := jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', 'PT', 'amount', (-v_source_amount)::text),
      jsonb_build_object('system_code', 'points_issuer', 'currency', 'PT', 'amount', v_source_amount::text),
      jsonb_build_object('system_code', 'points_issuer', 'currency', 'JPY', 'amount', (-v_source_amount)::text)
    );
    -- 精算通貨が JPY 以外なら、points_issuer が負担した JPY を fx_pool で精算通貨に換える
    if v_s.currency <> 'JPY' then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('system_code', 'fx_pool', 'currency', 'JPY', 'amount', v_source_amount::text),
        jsonb_build_object('system_code', 'fx_pool', 'currency', v_s.currency, 'amount', (-v_s.amount)::text)
      );
    end if;
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', p_source_currency, 'amount', (-v_source_amount)::text),
      jsonb_build_object('system_code', v_pool, 'currency', p_source_currency, 'amount', v_source_amount::text),
      jsonb_build_object('system_code', v_pool, 'currency', v_s.currency, 'amount', (-v_s.amount)::text)
    );
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('owner_type', 'merchant', 'owner_id', v_m.id, 'currency', v_s.currency, 'amount', v_net::text),
    jsonb_build_object('system_code', 'fee_revenue', 'currency', v_s.currency, 'amount', v_fee::text)
  );

  v_payment_id := gen_prefixed_id('pay_');
  v_journal := post_journal(
    'payment', 'payment:' || v_s.id, v_lines, 'payment', v_payment_id,
    jsonb_build_object('merchant_id', v_m.id, 'merchant_name', v_m.name, 'session_id', v_s.id, 'order_id', v_s.order_id,
                       'source_currency', p_source_currency, 'settlement_currency', v_s.currency,
                       'fx_rate', trim_scale(v_rate)::text, 'fee_amount', v_fee::text, 'description', coalesce(v_s.description, v_s.order_id, '決済'))
  );

  insert into payments (id, merchant_id, session_id, payer_user_id, source_currency, source_amount, settlement_currency, settlement_amount,
                        fx_rate, mid_rate, spread_bps, fee_amount, fee_bps, net_amount, order_id, description, metadata, journal_id)
  values (v_payment_id, v_m.id, v_s.id, p_user_id, p_source_currency, v_source_amount, v_s.currency, v_s.amount,
          v_rate, v_mid, v_spread, v_fee, v_fee_bps, v_net, v_s.order_id, v_s.description, v_s.metadata, v_journal)
  returning * into v_p;

  update checkout_sessions set status = 'completed', payment_id = v_payment_id, completed_at = now() where id = v_s.id returning * into v_s;

  perform enqueue_webhook_event(v_m.id, 'payment.succeeded', payment_json(v_p));
  perform enqueue_webhook_event(v_m.id, 'checkout.session.completed', checkout_session_json(v_s, p_app_url));

  insert into notifications (user_id, type, title, body, data)
  values (p_user_id, 'payment', v_m.name || ' での支払いが完了しました',
          coalesce(v_s.description, v_s.order_id, '') || '（' || p_source_currency || ' ' || v_source_amount::text || ' 最小単位）',
          jsonb_build_object('payment_id', v_payment_id, 'merchant_name', v_m.name, 'source_currency', p_source_currency, 'source_amount', v_source_amount::text,
                             'settlement_currency', v_s.currency, 'settlement_amount', v_s.amount::text));
  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('user', p_user_id::text, 'payment.succeeded', 'payment', v_payment_id, jsonb_build_object('merchant_id', v_m.id, 'session_id', v_s.id));

  return payment_json(v_p) || jsonb_build_object('session', checkout_session_json(v_s, p_app_url));
end $$;

-- ───────────────────────── 返金 ─────────────────────────
-- 加盟店残高（精算通貨）から減算 → 元の支払ソース通貨で、決済時の按分でユーザーへ戻す。
-- 手数料は返金しない（config.refund_returns_fee = true で切替）。部分返金は累計が元金額まで。
create or replace function refund_payment(p_payment_id text, p_merchant_id uuid, p_amount numeric default null, p_reason text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p payments%rowtype;
  v_r refunds%rowtype;
  v_amount numeric;
  v_remaining numeric;
  v_source_refund numeric;
  v_source_remaining numeric;
  v_fee_back numeric := 0;
  v_pool text;
  v_lines jsonb;
  v_journal uuid;
  v_status text;
  v_kind text;
begin
  select * into v_p from payments where id = p_payment_id and merchant_id = p_merchant_id for update;
  if not found then perform app_error('payment_not_found', '決済が見つかりません'); end if;

  if p_idempotency_key is not null then
    select * into v_r from refunds where merchant_id = p_merchant_id and idempotency_key = p_idempotency_key;
    if found then return refund_json(v_r); end if;
  end if;

  v_remaining := v_p.settlement_amount - v_p.refunded_amount;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or scale(v_amount) <> 0 then perform app_error('invalid_amount', '返金額は正の整数で指定してください', 'amount'); end if;
  if v_amount > v_remaining then
    perform app_error('refund_exceeds_payment', '返金額の累計が決済額を超えます（返金可能: ' || v_remaining::text || '）', 'amount');
  end if;

  -- 支払ソース通貨での返金額: 按分（最後の全額返金では残り全部）
  v_source_remaining := v_p.source_amount - v_p.refunded_source_amount;
  if v_amount = v_remaining then
    v_source_refund := v_source_remaining;
  else
    v_source_refund := floor(v_p.source_amount * v_amount / v_p.settlement_amount);
    if v_source_refund > v_source_remaining then v_source_refund := v_source_remaining; end if;
  end if;

  if cfg('refund_returns_fee') = 'true' then
    v_fee_back := floor(v_p.fee_amount * v_amount / v_p.settlement_amount);
  end if;

  -- 加盟店 -amount（手数料返還があれば fee_revenue から加盟店へ戻す）
  v_lines := jsonb_build_array(
    jsonb_build_object('owner_type', 'merchant', 'owner_id', v_p.merchant_id, 'currency', v_p.settlement_currency, 'amount', (-v_amount + v_fee_back)::text)
  );
  if v_fee_back > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('system_code', 'fee_revenue', 'currency', v_p.settlement_currency, 'amount', (-v_fee_back)::text)
    );
  end if;

  if v_p.source_currency = v_p.settlement_currency then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', v_p.payer_user_id, 'currency', v_p.source_currency, 'amount', v_amount::text)
    );
    v_source_refund := v_amount;
  elsif v_p.source_currency = 'PT' then
    -- 精算通貨 → JPY（fx_pool 経由、JPY 精算なら不要）→ points_issuer が JPY を回収して PT を再発行
    if v_p.settlement_currency <> 'JPY' then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('system_code', 'fx_pool', 'currency', v_p.settlement_currency, 'amount', v_amount::text),
        jsonb_build_object('system_code', 'fx_pool', 'currency', 'JPY', 'amount', (-v_source_refund)::text),
        jsonb_build_object('system_code', 'points_issuer', 'currency', 'JPY', 'amount', v_source_refund::text)
      );
    else
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('system_code', 'points_issuer', 'currency', 'JPY', 'amount', v_amount::text)
      );
    end if;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('system_code', 'points_issuer', 'currency', 'PT', 'amount', (-v_source_refund)::text),
      jsonb_build_object('owner_type', 'user', 'owner_id', v_p.payer_user_id, 'currency', 'PT', 'amount', v_source_refund::text)
    );
  else
    select kind into v_kind from currencies where code = v_p.source_currency;
    v_pool := case when v_kind = 'crypto' then 'crypto_custody' else 'fx_pool' end;
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('system_code', v_pool, 'currency', v_p.settlement_currency, 'amount', v_amount::text),
      jsonb_build_object('system_code', v_pool, 'currency', v_p.source_currency, 'amount', (-v_source_refund)::text),
      jsonb_build_object('owner_type', 'user', 'owner_id', v_p.payer_user_id, 'currency', v_p.source_currency, 'amount', v_source_refund::text)
    );
  end if;

  insert into refunds (id, payment_id, merchant_id, amount, currency, source_amount, source_currency, reason, idempotency_key)
  values (gen_prefixed_id('re_'), v_p.id, v_p.merchant_id, v_amount, v_p.settlement_currency, v_source_refund, v_p.source_currency, p_reason, p_idempotency_key)
  returning * into v_r;

  v_journal := post_journal(
    'refund', 'refund:' || v_r.id, v_lines, 'refund', v_r.id,
    jsonb_build_object('payment_id', v_p.id, 'merchant_id', v_p.merchant_id,
                       'merchant_name', (select name from merchants where id = v_p.merchant_id),
                       'reason', p_reason, 'description', '返金（' || coalesce(v_p.description, v_p.order_id, v_p.id) || '）')
  );
  update refunds set journal_id = v_journal where id = v_r.id returning * into v_r;

  v_status := case when v_p.refunded_amount + v_amount >= v_p.settlement_amount then 'refunded' else 'partially_refunded' end;
  update payments set refunded_amount = refunded_amount + v_amount, refunded_source_amount = refunded_source_amount + v_source_refund, status = v_status
  where id = v_p.id returning * into v_p;

  perform enqueue_webhook_event(v_p.merchant_id, 'payment.refunded', payment_json(v_p) || jsonb_build_object('refund', refund_json(v_r)));

  insert into notifications (user_id, type, title, body, data)
  values (v_p.payer_user_id, 'refund', '返金を受け取りました',
          (select name from merchants where id = v_p.merchant_id) || ' から ' || v_p.source_currency || ' で返金されました',
          jsonb_build_object('refund_id', v_r.id, 'payment_id', v_p.id, 'source_currency', v_p.source_currency, 'source_amount', v_source_refund::text));
  insert into audit_logs (actor_type, actor_id, action, target_type, target_id, metadata)
  values ('merchant', v_p.merchant_id::text, 'payment.refund', 'refund', v_r.id, jsonb_build_object('payment_id', v_p.id, 'amount', v_amount::text));

  return refund_json(v_r);
end $$;

-- ───────────────────────── 参照 RPC（加盟店） ─────────────────────────
create or replace function list_payments(p_merchant_id uuid, p_limit int default 20, p_starting_after text default null, p_status text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_cursor payments%rowtype;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then
    select * into v_cursor from payments where id = p_starting_after and merchant_id = p_merchant_id;
  end if;
  with rows as (
    select p.* from payments p
    where p.merchant_id = p_merchant_id
      and (p_status is null or p.status = p_status)
      and (v_cursor.id is null or (p.created_at, p.id) < (v_cursor.created_at, v_cursor.id))
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(payment_json(rows.*) order by rows.created_at desc, rows.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from rows;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;
  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

create or replace function get_payment(p_payment_id text, p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p payments%rowtype;
begin
  select * into v_p from payments where id = p_payment_id and merchant_id = p_merchant_id;
  if not found then perform app_error('payment_not_found', '決済が見つかりません'); end if;
  return payment_json(v_p) || jsonb_build_object('refunds', coalesce((
    select jsonb_agg(refund_json(r.*) order by r.created_at) from refunds r where r.payment_id = v_p.id), '[]'::jsonb));
end $$;

create or replace function get_refund(p_refund_id text, p_merchant_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r refunds%rowtype;
begin
  select * into v_r from refunds where id = p_refund_id and merchant_id = p_merchant_id;
  if not found then perform app_error('refund_not_found', '返金が見つかりません'); end if;
  return refund_json(v_r);
end $$;

create or replace function get_merchant_balance(p_merchant_id uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'object', 'balance',
    'available', coalesce((select jsonb_agg(jsonb_build_object('currency', a.currency, 'amount', a.balance::text) order by a.currency)
                           from accounts a where a.owner_type = 'merchant' and a.owner_id = p_merchant_id), '[]'::jsonb),
    'pending', '[]'::jsonb,
    'demo', true
  )
$$;

create or replace function list_merchant_balance_transactions(p_merchant_id uuid, p_limit int default 20, p_starting_after text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_cursor bigint;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then v_cursor := p_starting_after::bigint; end if;
  with rows as (
    select l.id, l.journal_id, j.type, l.currency, l.amount, j.reference_type, j.reference_id, j.created_at, j.metadata
    from ledger_lines l
    join accounts a on a.id = l.account_id and a.owner_type = 'merchant' and a.owner_id = p_merchant_id
    join journal_entries j on j.id = l.journal_id
    where (v_cursor is null or l.id < v_cursor)
    order by l.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', rows.id::text, 'journal_id', rows.journal_id, 'type', rows.type, 'currency', rows.currency, 'amount', rows.amount::text,
           'reference_type', rows.reference_type, 'reference_id', rows.reference_id, 'created_at', rows.created_at,
           'description', rows.metadata->>'description'
         ) order by rows.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from rows;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;
  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

-- ダッシュボードのサマリ
create or replace function get_merchant_dashboard(p_merchant_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m merchants%rowtype := assert_merchant_owner(p_merchant_id, p_user_id);
begin
  return jsonb_build_object(
    'merchant', merchant_json(v_m),
    'balance', get_merchant_balance(p_merchant_id),
    'stats', jsonb_build_object(
      'payments_count', (select count(*) from payments where merchant_id = p_merchant_id),
      'payments_today', (select count(*) from payments where merchant_id = p_merchant_id and created_at >= date_trunc('day', now())),
      'gross_volume', coalesce((select sum(settlement_amount) from payments where merchant_id = p_merchant_id), 0)::text,
      'gross_volume_today', coalesce((select sum(settlement_amount) from payments where merchant_id = p_merchant_id and created_at >= date_trunc('day', now())), 0)::text,
      'fees_total', coalesce((select sum(fee_amount) from payments where merchant_id = p_merchant_id), 0)::text,
      'refunded_total', coalesce((select sum(refunded_amount) from payments where merchant_id = p_merchant_id), 0)::text,
      'open_sessions', (select count(*) from checkout_sessions where merchant_id = p_merchant_id and status = 'open' and expires_at > now()),
      'webhook_failed', (select count(*) from webhook_deliveries where merchant_id = p_merchant_id and status = 'failed'),
      'api_keys_active', (select count(*) from api_keys where merchant_id = p_merchant_id and revoked_at is null),
      'webhook_endpoints', (select count(*) from webhook_endpoints where merchant_id = p_merchant_id and deleted_at is null)
    ),
    'recent_payments', (list_payments(p_merchant_id, 5, null, null))->'data',
    'by_source', coalesce((
      select jsonb_agg(jsonb_build_object('source_currency', s.source_currency, 'count', s.n, 'settlement_amount', s.total::text) order by s.n desc)
      from (select source_currency, count(*) n, sum(settlement_amount) total from payments where merchant_id = p_merchant_id group by source_currency) s
    ), '[]'::jsonb)
  );
end $$;

-- 管理者向け: 全加盟店
create or replace function admin_list_merchants(p_limit int default 100) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(merchant_json(m.*) || jsonb_build_object(
             'owner_email', (select email from profiles where user_id = m.owner_user_id),
             'balance', get_merchant_balance(m.id)->'available',
             'payments_count', (select count(*) from payments where merchant_id = m.id)
           ) order by m.created_at desc)
    from (select * from merchants order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) m
  ), '[]'::jsonb))
$$;

-- get_me に merchant_ids を含める
create or replace function get_me(p_user_id uuid, p_email text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
  v_wallets jsonb;
  v_total   numeric := 0;
begin
  select * into v_profile from profiles where user_id = p_user_id;
  if not found then
    perform ensure_profile(p_user_id, p_email);
    select * into v_profile from profiles where user_id = p_user_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', c.code,
           'kind', c.kind,
           'balance', coalesce(a.balance, 0)::text,
           'jpy_value', convert_to_jpy(c.code, coalesce(a.balance, 0))::text
         ) order by c.sort_order), '[]'::jsonb),
         coalesce(sum(convert_to_jpy(c.code, coalesce(a.balance, 0))), 0)
  into v_wallets, v_total
  from currencies c
  left join accounts a on a.currency = c.code and a.owner_type = 'user' and a.owner_id = p_user_id;

  return jsonb_build_object(
    'profile', profile_json(v_profile),
    'wallets', v_wallets,
    'total_jpy', v_total::text,
    'merchant_ids', coalesce((select jsonb_agg(id order by created_at) from merchants where owner_user_id = p_user_id), '[]'::jsonb)
  );
end $$;

-- ───────────────────────── RLS ─────────────────────────
alter table merchants enable row level security;
alter table api_keys enable row level security;
alter table checkout_sessions enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table webhook_endpoints enable row level security;
alter table webhook_events enable row level security;
alter table webhook_deliveries enable row level security;
alter table idempotency_keys enable row level security;
alter table api_rate_limits enable row level security;
alter table api_request_logs enable row level security;
alter table audit_logs enable row level security;
drop policy if exists merchants_owner on merchants;
create policy merchants_owner on merchants for select using (owner_user_id = auth.uid());
drop policy if exists payments_payer on payments;
create policy payments_payer on payments for select using (payer_user_id = auth.uid());

revoke execute on all functions in schema public from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on all functions in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on all functions in schema public from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
