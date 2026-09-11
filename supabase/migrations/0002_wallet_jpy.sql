-- ============================================================================
-- payCcount 0002: JPY ウォレット（模擬カードチャージ・模擬銀行振込）
--
-- 銀行振込は実務と同じ流れ:
--   通知受信 → 金額・振込先照合 → 冪等チェック → 仕訳 → ユーザー通知
-- ============================================================================
set client_min_messages = warning;

-- ───────────────────────── チャージ ─────────────────────────
create table if not exists topups (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(user_id) on delete cascade,
  method         text not null check (method in ('card','bank_transfer')),
  currency       text not null references currencies(code),
  amount         numeric(40,0) not null check (amount > 0),
  status         text not null check (status in ('pending','succeeded','failed')),
  provider_ref   text,            -- 模擬カード決済の参照 / 銀行の入金参照番号
  failure_reason text,
  card_last4     text,
  card_brand     text,
  journal_id     uuid references journal_entries(id),
  created_at     timestamptz not null default now()
);
create index if not exists topups_user_idx on topups (user_id, created_at desc);

-- ───────────────────────── 模擬振込先 ─────────────────────────
create table if not exists virtual_bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references profiles(user_id) on delete cascade,
  bank_name      text not null default 'payCcountデモ銀行',
  bank_code      text not null default '9999',
  branch_name    text not null default 'デモ支店',
  branch_code    text not null default '001',
  account_type   text not null default '普通',
  account_number text not null unique,
  holder_name    text not null,
  created_at     timestamptz not null default now()
);

-- ───────────────────────── 入金通知 ─────────────────────────
create table if not exists bank_deposit_notifications (
  id                 uuid primary key default gen_random_uuid(),
  virtual_account_id uuid references virtual_bank_accounts(id),
  account_number     text not null,
  amount             numeric(40,0) not null,
  currency           text not null default 'JPY',
  payer_name         text,
  external_ref       text unique,          -- 銀行側の入金参照番号（冪等キー）
  status             text not null check (status in ('processed','unmatched','duplicate','rejected')),
  reject_reason      text,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  topup_id           uuid references topups(id),
  point_purchase_id  uuid                  -- Phase 4 でポイント購入の振込に使う
);
create index if not exists bank_deposit_notifications_va_idx on bank_deposit_notifications (virtual_account_id, received_at desc);

-- ───────────────────────── JSON 変換 ─────────────────────────
create or replace function topup_json(t topups) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', t.id,
    'user_id', t.user_id,
    'method', t.method,
    'currency', t.currency,
    'amount', t.amount::text,
    'status', t.status,
    'provider_ref', t.provider_ref,
    'failure_reason', t.failure_reason,
    'card_last4', t.card_last4,
    'card_brand', t.card_brand,
    'journal_id', t.journal_id,
    'created_at', t.created_at
  )
$$;

create or replace function virtual_bank_account_json(v virtual_bank_accounts) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', v.id,
    'user_id', v.user_id,
    'bank_name', v.bank_name,
    'bank_code', v.bank_code,
    'branch_name', v.branch_name,
    'branch_code', v.branch_code,
    'account_type', v.account_type,
    'account_number', v.account_number,
    'holder_name', v.holder_name,
    'created_at', v.created_at
  )
$$;

create or replace function bank_deposit_notification_json(n bank_deposit_notifications) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', n.id,
    'virtual_account_id', n.virtual_account_id,
    'account_number', n.account_number,
    'amount', n.amount::text,
    'currency', n.currency,
    'payer_name', n.payer_name,
    'external_ref', n.external_ref,
    'status', n.status,
    'reject_reason', n.reject_reason,
    'received_at', n.received_at,
    'processed_at', n.processed_at,
    'topup_id', n.topup_id,
    'point_purchase_id', n.point_purchase_id
  )
$$;

-- ───────────────────────── 模擬カードチャージ ─────────────────────────
-- API 層がテストカード番号から p_outcome（succeeded / failed）を決めて呼ぶ。
-- 成功時: user JPY +amount / card_clearing JPY -amount
create or replace function topup_card(
  p_user_id         uuid,
  p_amount          numeric,
  p_currency        text,
  p_outcome         text,
  p_card_last4      text default null,
  p_card_brand      text default null,
  p_failure_reason  text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_topup topups%rowtype;
  v_journal_id uuid;
  v_ref text;
begin
  if p_currency <> 'JPY' then
    perform app_error('unsupported_currency', 'カードチャージは JPY のみ対応しています', 'currency');
  end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) <> 0 then
    perform app_error('invalid_amount', '金額は 1 以上の整数で指定してください', 'amount');
  end if;
  if p_outcome not in ('succeeded','failed') then
    perform app_error('invalid_outcome', 'outcome が不正です');
  end if;

  -- 冪等: 同じキーの topup があれば返す
  if p_idempotency_key is not null then
    select t.* into v_topup from topups t
    join journal_entries j on j.id = t.journal_id
    where j.idempotency_key = p_idempotency_key;
    if found then
      return topup_json(v_topup);
    end if;
  end if;

  v_ref := 'mock_card_' || encode(gen_random_bytes(6), 'hex');

  insert into topups (user_id, method, currency, amount, status, provider_ref, failure_reason, card_last4, card_brand)
  values (p_user_id, 'card', p_currency, p_amount, p_outcome, v_ref, p_failure_reason, p_card_last4, p_card_brand)
  returning * into v_topup;

  if p_outcome = 'succeeded' then
    v_journal_id := post_journal(
      'topup_card',
      coalesce(p_idempotency_key, 'topup_card:' || v_topup.id::text),
      jsonb_build_array(
        jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', p_currency, 'amount', p_amount::text),
        jsonb_build_object('system_code', 'card_clearing', 'currency', p_currency, 'amount', (-p_amount)::text)
      ),
      'topup', v_topup.id::text,
      jsonb_build_object('method', 'card', 'card_last4', p_card_last4, 'card_brand', p_card_brand, 'description', 'カードチャージ')
    );
    update topups set journal_id = v_journal_id where id = v_topup.id returning * into v_topup;

    insert into notifications (user_id, type, title, body, data)
    values (p_user_id, 'topup_card', 'チャージが完了しました',
            '¥' || to_char(p_amount, 'FM999,999,999,999') || ' をカードでチャージしました',
            jsonb_build_object('topup_id', v_topup.id, 'amount', p_amount::text, 'currency', p_currency));
  end if;

  return topup_json(v_topup);
end $$;

create or replace function list_topups(p_user_id uuid, p_limit int default 20, p_starting_after text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_cursor topups%rowtype;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then
    select * into v_cursor from topups where id = p_starting_after::uuid and user_id = p_user_id;
  end if;
  with rows as (
    select t.* from topups t
    where t.user_id = p_user_id
      and (v_cursor.id is null or (t.created_at, t.id) < (v_cursor.created_at, v_cursor.id))
    order by t.created_at desc, t.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(topup_json(rows.*) order by rows.created_at desc, rows.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from rows;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;
  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

-- ───────────────────────── 模擬振込先の発行 ─────────────────────────
create or replace function issue_virtual_bank_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_va virtual_bank_accounts%rowtype;
  v_holder text;
  v_number text;
  v_try int := 0;
begin
  select * into v_va from virtual_bank_accounts where user_id = p_user_id;
  if found then
    return virtual_bank_account_json(v_va);
  end if;

  select coalesce(nullif(display_name, ''), 'ﾕｰｻﾞｰ') into v_holder from profiles where user_id = p_user_id;
  if v_holder is null then
    perform app_error('not_found', 'プロフィールが見つかりません');
  end if;

  loop
    v_try := v_try + 1;
    v_number := lpad((floor(random() * 9000000) + 1000000)::bigint::text, 7, '0');
    exit when not exists (select 1 from virtual_bank_accounts where account_number = v_number);
    if v_try > 50 then
      perform app_error('api_error', '口座番号を採番できませんでした');
    end if;
  end loop;

  insert into virtual_bank_accounts (user_id, account_number, holder_name)
  values (p_user_id, v_number, v_holder)
  on conflict (user_id) do nothing
  returning * into v_va;
  if v_va.id is null then
    select * into v_va from virtual_bank_accounts where user_id = p_user_id;
  end if;
  return virtual_bank_account_json(v_va);
end $$;

create or replace function get_virtual_bank_account_by_id(p_id uuid) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select virtual_bank_account_json(v.*) from virtual_bank_accounts v where v.id = p_id
$$;

-- ───────────────────────── 入金通知処理（見せ場） ─────────────────────────
-- 1. 通知受信（記録）
-- 2. 冪等チェック（external_ref）
-- 3. 振込先照合（account_number → virtual_bank_accounts）
-- 4. 金額検証
-- 5. topup 作成 + 仕訳（user JPY + / bank_clearing JPY -）
-- 6. ユーザー通知
-- 照合できない入金は status='unmatched' として記録し、API 層が 404 を返す。
create or replace function process_bank_deposit(
  p_account_number text,
  p_amount         numeric,
  p_payer_name     text default null,
  p_external_ref   text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ref     text := coalesce(nullif(p_external_ref, ''), 'dep_' || encode(gen_random_bytes(8), 'hex'));
  v_existing bank_deposit_notifications%rowtype;
  v_va      virtual_bank_accounts%rowtype;
  v_notif   bank_deposit_notifications%rowtype;
  v_topup   topups%rowtype;
  v_journal uuid;
begin
  -- 2. 冪等チェック: 同じ参照番号の通知は二重処理しない
  select * into v_existing from bank_deposit_notifications where external_ref = v_ref;
  if found then
    if v_existing.topup_id is not null then
      select * into v_topup from topups where id = v_existing.topup_id;
    end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'notification', bank_deposit_notification_json(v_existing),
      'topup', case when v_topup.id is null then null else topup_json(v_topup) end
    );
  end if;

  -- 3. 振込先照合
  select * into v_va from virtual_bank_accounts where account_number = p_account_number;
  if not found then
    insert into bank_deposit_notifications (account_number, amount, payer_name, external_ref, status, reject_reason)
    values (coalesce(p_account_number, ''), coalesce(p_amount, 0), p_payer_name, v_ref, 'unmatched', '振込先口座が見つかりません')
    returning * into v_notif;
    return jsonb_build_object('status', 'unmatched', 'notification', bank_deposit_notification_json(v_notif), 'topup', null);
  end if;

  -- 4. 金額検証
  if p_amount is null or p_amount <= 0 or scale(p_amount) <> 0 then
    insert into bank_deposit_notifications (virtual_account_id, account_number, amount, payer_name, external_ref, status, reject_reason)
    values (v_va.id, p_account_number, coalesce(p_amount, 0), p_payer_name, v_ref, 'rejected', '金額が不正です')
    returning * into v_notif;
    return jsonb_build_object('status', 'rejected', 'notification', bank_deposit_notification_json(v_notif), 'topup', null);
  end if;

  -- 1. 通知記録
  insert into bank_deposit_notifications (virtual_account_id, account_number, amount, payer_name, external_ref, status)
  values (v_va.id, p_account_number, p_amount, p_payer_name, v_ref, 'processed')
  returning * into v_notif;

  -- 5. チャージ + 仕訳
  insert into topups (user_id, method, currency, amount, status, provider_ref)
  values (v_va.user_id, 'bank_transfer', 'JPY', p_amount, 'succeeded', v_ref)
  returning * into v_topup;

  v_journal := post_journal(
    'topup_bank',
    'bank_deposit:' || v_ref,
    jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', v_va.user_id, 'currency', 'JPY', 'amount', p_amount::text),
      jsonb_build_object('system_code', 'bank_clearing', 'currency', 'JPY', 'amount', (-p_amount)::text)
    ),
    'topup', v_topup.id::text,
    jsonb_build_object('method', 'bank_transfer', 'payer_name', p_payer_name, 'external_ref', v_ref,
                       'description', '銀行振込（' || coalesce(p_payer_name, '振込人不明') || '）')
  );

  update topups set journal_id = v_journal where id = v_topup.id returning * into v_topup;
  update bank_deposit_notifications set processed_at = now(), topup_id = v_topup.id where id = v_notif.id returning * into v_notif;

  -- 6. ユーザー通知
  insert into notifications (user_id, type, title, body, data)
  values (v_va.user_id, 'topup_bank', '入金を確認しました',
          '¥' || to_char(p_amount, 'FM999,999,999,999') || ' の振込（' || coalesce(p_payer_name, '振込人不明') || '）を残高に反映しました',
          jsonb_build_object('topup_id', v_topup.id, 'amount', p_amount::text, 'currency', 'JPY', 'payer_name', p_payer_name));

  return jsonb_build_object(
    'status', 'processed',
    'notification', bank_deposit_notification_json(v_notif),
    'topup', topup_json(v_topup)
  );
end $$;

-- ユーザーの振込先に届いた入金通知一覧
create or replace function list_bank_deposits(p_user_id uuid, p_limit int default 20) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(bank_deposit_notification_json(n.*) order by n.received_at desc)
    from (
      select n.* from bank_deposit_notifications n
      join virtual_bank_accounts v on v.id = n.virtual_account_id
      where v.user_id = p_user_id
      order by n.received_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 100)
    ) n
  ), '[]'::jsonb), 'has_more', false)
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table topups enable row level security;
alter table virtual_bank_accounts enable row level security;
alter table bank_deposit_notifications enable row level security;
drop policy if exists topups_self on topups;
create policy topups_self on topups for select using (user_id = auth.uid());
drop policy if exists virtual_bank_accounts_self on virtual_bank_accounts;
create policy virtual_bank_accounts_self on virtual_bank_accounts for select using (user_id = auth.uid());

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
