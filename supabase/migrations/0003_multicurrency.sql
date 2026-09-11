-- ============================================================================
-- payCcount 0003: マルチカレンシー（USD / EUR / GBP、レート、両替 Quote → Execute）
--
-- レートはすべて「X/JPY」で rates に保存し、クロスレートは JPY 経由で計算する。
-- 両替は fx_pool 勘定を経由し、スプレッド分は fx_pool に残る。
-- ============================================================================
set client_min_messages = warning;

insert into currencies (code, kind, decimals, name, sort_order) values
  ('USD', 'fiat', 2, '米ドル', 20),
  ('EUR', 'fiat', 2, 'ユーロ', 30),
  ('GBP', 'fiat', 2, '英ポンド', 40)
on conflict (code) do nothing;

-- ───────────────────────── レート ─────────────────────────
create table if not exists rates (
  id         uuid primary key default gen_random_uuid(),
  base       text not null references currencies(code),
  quote      text not null references currencies(code),
  rate       numeric(30,12) not null check (rate > 0),
  source     text not null default 'seed',
  fetched_at timestamptz not null default now(),
  unique (base, quote)
);

insert into rates (base, quote, rate, source) values
  ('USD', 'JPY', 150.000000000000, 'seed'),
  ('EUR', 'JPY', 162.000000000000, 'seed'),
  ('GBP', 'JPY', 190.000000000000, 'seed')
on conflict (base, quote) do nothing;

create or replace function rate_json(r rates) returns jsonb
language sql immutable as $$
  select jsonb_build_object('base', r.base, 'quote', r.quote, 'rate', trim_scale(r.rate)::text, 'source', r.source, 'fetched_at', r.fetched_at)
$$;

-- レートの upsert（モック / live プロバイダから呼ぶ）
create or replace function set_rate(p_base text, p_quote text, p_rate numeric, p_source text default 'mock') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_r rates%rowtype;
begin
  if p_rate is null or p_rate <= 0 then
    perform app_error('invalid_rate', 'レートは正の数で指定してください', 'rate');
  end if;
  if not exists (select 1 from currencies where code = p_base) or not exists (select 1 from currencies where code = p_quote) then
    perform app_error('invalid_currency', '未対応の通貨です', 'base');
  end if;
  insert into rates (base, quote, rate, source, fetched_at)
  values (p_base, p_quote, p_rate, coalesce(p_source, 'mock'), now())
  on conflict (base, quote) do update set rate = excluded.rate, source = excluded.source, fetched_at = now()
  returning * into v_r;
  return rate_json(v_r);
end $$;

-- シード値に戻す（RATES_PROVIDER=mock の /mock/rates/refresh）。Phase 3 でクリプトも追加
create or replace function reseed_rates() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_rows jsonb;
begin
  insert into rates (base, quote, rate, source, fetched_at)
  select s.base, s.quote, s.rate, 'seed', now()
  from (values ('USD','JPY',150::numeric), ('EUR','JPY',162::numeric), ('GBP','JPY',190::numeric),
               ('BTC','JPY',15000000::numeric), ('ETH','JPY',500000::numeric)) as s(base, quote, rate)
  where exists (select 1 from currencies where code = s.base)
  on conflict (base, quote) do update set rate = excluded.rate, source = 'seed', fetched_at = now();
  select coalesce(jsonb_agg(rate_json(r.*) order by r.base), '[]'::jsonb) into v_rows from rates r;
  return v_rows;
end $$;

-- ミッドレート base→quote（1 base = ? quote）。PT は JPY と等価
create or replace function get_rate(p_base text, p_quote text) returns numeric
language plpgsql stable set search_path = public, extensions as $$
declare
  v_base text := case when p_base = 'PT' then 'JPY' else p_base end;
  v_quote text := case when p_quote = 'PT' then 'JPY' else p_quote end;
  v_b numeric;
  v_q numeric;
begin
  if v_base = v_quote then return 1; end if;
  select rate into v_b from rates where base = v_base and quote = v_quote;
  if found then return v_b; end if;
  select rate into v_b from rates where base = v_quote and quote = v_base;
  if found then return 1 / v_b; end if;
  -- JPY 経由のクロス
  if v_base = 'JPY' then
    select rate into v_q from rates where base = v_quote and quote = 'JPY';
    if found then return 1 / v_q; end if;
  elsif v_quote = 'JPY' then
    select rate into v_b from rates where base = v_base and quote = 'JPY';
    if found then return v_b; end if;
  else
    select rate into v_b from rates where base = v_base and quote = 'JPY';
    select rate into v_q from rates where base = v_quote and quote = 'JPY';
    if v_b is not null and v_q is not null then return v_b / v_q; end if;
  end if;
  return null;
end $$;

create or replace function get_rate_json(p_base text, p_quote text) returns jsonb
language plpgsql stable set search_path = public, extensions as $$
declare
  v_rate numeric;
  v_src text;
  v_at timestamptz;
begin
  v_rate := get_rate(p_base, p_quote);
  if v_rate is null then
    perform app_error('rate_not_found', 'レートが見つかりません: ' || p_base || '/' || p_quote, 'base');
  end if;
  select source, fetched_at into v_src, v_at from rates
  where (base = p_base and quote = p_quote) or (base = p_quote and quote = p_base) or (base in (p_base, p_quote) and quote = 'JPY')
  order by fetched_at desc limit 1;
  return jsonb_build_object('base', p_base, 'quote', p_quote, 'rate', trim_scale(v_rate)::text,
                            'source', coalesce(v_src, 'derived'), 'fetched_at', coalesce(v_at, now()));
end $$;

create or replace function list_rates() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((select jsonb_agg(rate_json(r.*) order by r.base) from rates r), '[]'::jsonb))
$$;

-- 最小単位の換算: from_minor → to_minor（p_rate は 1 from = p_rate to）。切り捨て
create or replace function convert_minor(p_amount numeric, p_from text, p_to text, p_rate numeric) returns numeric
language plpgsql stable set search_path = public, extensions as $$
declare
  v_from_dec int;
  v_to_dec int;
begin
  select decimals into v_from_dec from currencies where code = p_from;
  select decimals into v_to_dec from currencies where code = p_to;
  if v_from_dec is null or v_to_dec is null or p_rate is null then return null; end if;
  -- 乗算は numeric で厳密。最後の 10^from_dec での除算だけを div()（切り捨て）で行い丸め誤差を避ける
  return div(p_amount * p_rate * power(10::numeric, v_to_dec), power(10::numeric, v_from_dec));
end $$;

-- 切り上げ版（ユーザーが「支払う側」の必要額を出すとき）
create or replace function convert_minor_ceil(p_amount numeric, p_from text, p_to text, p_rate numeric) returns numeric
language plpgsql stable set search_path = public, extensions as $$
declare
  v_from_dec int;
  v_to_dec int;
  v_num numeric;
  v_den numeric;
  v_q numeric;
begin
  select decimals into v_from_dec from currencies where code = p_from;
  select decimals into v_to_dec from currencies where code = p_to;
  if v_from_dec is null or v_to_dec is null or p_rate is null then return null; end if;
  v_num := p_amount * p_rate * power(10::numeric, v_to_dec);
  v_den := power(10::numeric, v_from_dec);
  v_q := div(v_num, v_den);
  if v_q * v_den < v_num then v_q := v_q + 1; end if;
  return v_q;
end $$;

-- 「価格で割る」版: from_minor → to_minor（p_price は 1 to = p_price from）。切り捨て / 切り上げ
create or replace function convert_minor_div(p_amount numeric, p_from text, p_to text, p_price numeric) returns numeric
language plpgsql stable set search_path = public, extensions as $$
declare
  v_from_dec int;
  v_to_dec int;
begin
  select decimals into v_from_dec from currencies where code = p_from;
  select decimals into v_to_dec from currencies where code = p_to;
  if v_from_dec is null or v_to_dec is null or p_price is null or p_price = 0 then return null; end if;
  return div(p_amount * power(10::numeric, v_to_dec), p_price * power(10::numeric, v_from_dec));
end $$;

create or replace function convert_minor_div_ceil(p_amount numeric, p_from text, p_to text, p_price numeric) returns numeric
language plpgsql stable set search_path = public, extensions as $$
declare
  v_from_dec int;
  v_to_dec int;
  v_num numeric;
  v_den numeric;
  v_q numeric;
begin
  select decimals into v_from_dec from currencies where code = p_from;
  select decimals into v_to_dec from currencies where code = p_to;
  if v_from_dec is null or v_to_dec is null or p_price is null or p_price = 0 then return null; end if;
  v_num := p_amount * power(10::numeric, v_to_dec);
  v_den := p_price * power(10::numeric, v_from_dec);
  v_q := div(v_num, v_den);
  if v_q * v_den < v_num then v_q := v_q + 1; end if;
  return v_q;
end $$;

-- JPY 換算（Phase 0 の暫定実装を置き換え）
create or replace function convert_to_jpy(p_currency text, p_amount numeric) returns numeric
language plpgsql stable set search_path = public, extensions as $$
declare
  v_rate numeric;
begin
  if p_currency in ('JPY', 'PT') then return p_amount; end if;
  v_rate := get_rate(p_currency, 'JPY');
  if v_rate is null then return 0; end if;
  return coalesce(convert_minor(p_amount, p_currency, 'JPY', v_rate), 0);
end $$;

-- ───────────────────────── 両替 Quote ─────────────────────────
create table if not exists fx_quotes (
  id            text primary key,
  user_id       uuid not null references profiles(user_id) on delete cascade,
  from_currency text not null references currencies(code),
  to_currency   text not null references currencies(code),
  from_amount   numeric(40,0) not null check (from_amount > 0),
  to_amount     numeric(40,0) not null check (to_amount > 0),
  rate          numeric(30,12) not null,   -- 実効レート（スプレッド込み）
  mid_rate      numeric(30,12) not null,
  spread_bps    int not null,
  expires_at    timestamptz not null,
  status        text not null default 'open' check (status in ('open','executed','expired')),
  journal_id    uuid references journal_entries(id),
  created_at    timestamptz not null default now(),
  executed_at   timestamptz
);
create index if not exists fx_quotes_user_idx on fx_quotes (user_id, created_at desc);

create or replace function fx_quote_json(q fx_quotes) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', q.id, 'user_id', q.user_id,
    'from_currency', q.from_currency, 'to_currency', q.to_currency,
    'from_amount', q.from_amount::text, 'to_amount', q.to_amount::text,
    'rate', trim_scale(q.rate)::text, 'mid_rate', trim_scale(q.mid_rate)::text, 'spread_bps', q.spread_bps,
    'expires_at', q.expires_at, 'status', q.status, 'journal_id', q.journal_id,
    'created_at', q.created_at, 'executed_at', q.executed_at
  )
$$;

create or replace function create_fx_quote(p_user_id uuid, p_from text, p_to text, p_from_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_from currencies%rowtype;
  v_to currencies%rowtype;
  v_mid numeric;
  v_spread int := cfg_int('fx_spread_bps', 50);
  v_ttl int := cfg_int('fx_quote_ttl_seconds', 60);
  v_rate numeric;
  v_to_amount numeric;
  v_q fx_quotes%rowtype;
begin
  select * into v_from from currencies where code = p_from;
  select * into v_to from currencies where code = p_to;
  if v_from.code is null or v_to.code is null then
    perform app_error('invalid_currency', '未対応の通貨です', 'from_currency');
  end if;
  if v_from.kind <> 'fiat' or v_to.kind <> 'fiat' then
    perform app_error('unsupported_currency', '両替は法定通貨（JPY/USD/EUR/GBP）同士のみ対応しています。ポイントは両替できません', 'from_currency');
  end if;
  if p_from = p_to then
    perform app_error('same_currency', '同じ通貨同士は両替できません', 'to_currency');
  end if;
  if p_from_amount is null or p_from_amount <= 0 or scale(p_from_amount) <> 0 then
    perform app_error('invalid_amount', '金額は 1 以上の整数で指定してください', 'from_amount');
  end if;
  v_mid := get_rate(p_from, p_to);
  if v_mid is null then
    perform app_error('rate_not_found', 'レートが見つかりません', 'from_currency');
  end if;
  v_rate := v_mid * (1 - v_spread::numeric / 10000);
  v_to_amount := convert_minor(p_from_amount, p_from, p_to, v_rate);
  if v_to_amount is null or v_to_amount <= 0 then
    perform app_error('amount_too_small', '金額が小さすぎます', 'from_amount');
  end if;

  insert into fx_quotes (id, user_id, from_currency, to_currency, from_amount, to_amount, rate, mid_rate, spread_bps, expires_at)
  values (gen_prefixed_id('qt_'), p_user_id, p_from, p_to, p_from_amount, v_to_amount, v_rate, v_mid, v_spread, now() + make_interval(secs => v_ttl))
  returning * into v_q;
  return fx_quote_json(v_q);
end $$;

create or replace function get_fx_quote(p_user_id uuid, p_quote_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_q fx_quotes%rowtype;
begin
  select * into v_q from fx_quotes where id = p_quote_id and user_id = p_user_id;
  if not found then
    perform app_error('quote_not_found', '見積もりが見つかりません');
  end if;
  if v_q.status = 'open' and v_q.expires_at < now() then
    update fx_quotes set status = 'expired' where id = v_q.id returning * into v_q;
  end if;
  return fx_quote_json(v_q);
end $$;

create or replace function list_fx_quotes(p_user_id uuid, p_limit int default 20) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(fx_quote_json(q.*) order by q.created_at desc)
    from (select * from fx_quotes where user_id = p_user_id order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) q
  ), '[]'::jsonb), 'has_more', false)
$$;

-- 両替の確定: user from - / fx_pool from + / fx_pool to - / user to +
create or replace function execute_fx_quote(p_user_id uuid, p_quote_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_q fx_quotes%rowtype;
  v_journal uuid;
begin
  select * into v_q from fx_quotes where id = p_quote_id and user_id = p_user_id for update;
  if not found then
    perform app_error('quote_not_found', '見積もりが見つかりません');
  end if;
  if v_q.status = 'executed' then
    return fx_quote_json(v_q);   -- 冪等
  end if;
  if v_q.status = 'expired' or v_q.expires_at < now() then
    update fx_quotes set status = 'expired' where id = v_q.id;
    perform app_error('quote_expired', '見積もりの有効期限が切れました。再度見積もりを取得してください');
  end if;

  v_journal := post_journal(
    'fx_convert',
    'fx_quote:' || v_q.id,
    jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', v_q.from_currency, 'amount', (-v_q.from_amount)::text),
      jsonb_build_object('system_code', 'fx_pool', 'currency', v_q.from_currency, 'amount', v_q.from_amount::text),
      jsonb_build_object('system_code', 'fx_pool', 'currency', v_q.to_currency, 'amount', (-v_q.to_amount)::text),
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', v_q.to_currency, 'amount', v_q.to_amount::text)
    ),
    'fx_quote', v_q.id,
    jsonb_build_object('from_currency', v_q.from_currency, 'to_currency', v_q.to_currency,
                       'rate', trim_scale(v_q.rate)::text, 'mid_rate', trim_scale(v_q.mid_rate)::text, 'spread_bps', v_q.spread_bps,
                       'description', v_q.from_currency || ' → ' || v_q.to_currency)
  );

  update fx_quotes set status = 'executed', journal_id = v_journal, executed_at = now() where id = v_q.id returning * into v_q;
  return fx_quote_json(v_q);
end $$;

-- 期限切れ Quote の掃除（Cron から）
create or replace function expire_fx_quotes() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_n int;
begin
  update fx_quotes set status = 'expired' where status = 'open' and expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── RLS ─────────────────────────
alter table rates enable row level security;
alter table fx_quotes enable row level security;
drop policy if exists rates_public on rates;
create policy rates_public on rates for select using (true);
drop policy if exists fx_quotes_self on fx_quotes;
create policy fx_quotes_self on fx_quotes for select using (user_id = auth.uid());

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
