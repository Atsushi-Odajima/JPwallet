-- ============================================================================
-- payCcount 0001: 足場（通貨・設定・プロフィール・複式簿記台帳）
--
-- 台帳のルール
--   * すべての残高変動は post_journal() を通す。accounts.balance を直接 UPDATE しない
--   * 同一 journal・同一通貨の ledger_lines.amount 合計は 0
--   * owner_type in ('user','merchant') の口座は残高 >= 0
--   * 業務エラーは app_error(code, message) で raise し、API 層が HTTP に変換する
-- ============================================================================

create extension if not exists pgcrypto;

-- ───────────────────────── 通貨 ─────────────────────────
create table if not exists currencies (
  code        text primary key,
  kind        text not null check (kind in ('fiat','crypto','points')),
  decimals    int  not null check (decimals between 0 and 18),
  name        text not null,
  sort_order  int  not null default 100
);

insert into currencies (code, kind, decimals, name, sort_order) values
  ('JPY', 'fiat', 0, '日本円', 10)
on conflict (code) do nothing;

-- ───────────────────────── 設定値 ─────────────────────────
create table if not exists config (
  key         text primary key,
  value       text not null,
  description text
);

insert into config (key, value, description) values
  ('merchant_fee_bps',            '160',   '加盟店決済手数料（bps）'),
  ('fx_spread_bps',               '50',    '為替スプレッド（bps）'),
  ('crypto_spread_bps',           '100',   'クリプト売買スプレッド（bps）'),
  ('checkout_session_ttl_minutes','30',    'Checkout Session 有効期限（分）'),
  ('fx_quote_ttl_seconds',        '60',    'FX Quote 有効期限（秒）'),
  ('refund_returns_fee',          'false', '返金時に決済手数料も戻すか')
on conflict (key) do nothing;

create or replace function cfg(p_key text) returns text
language sql stable set search_path = public as $$
  select value from config where key = p_key
$$;

create or replace function cfg_int(p_key text, p_default int) returns int
language sql stable set search_path = public as $$
  select coalesce((select value from config where key = p_key)::int, p_default)
$$;

-- ───────────────────────── エラー ─────────────────────────
-- message にエラーコード、detail に人間向けメッセージ、hint にパラメータ名を入れる。
create or replace function app_error(p_code text, p_message text default null, p_param text default null)
returns void language plpgsql as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail  = coalesce(p_message, p_code),
    hint    = coalesce(p_param, '');
end $$;

-- ───────────────────────── ID 生成 ─────────────────────────
create or replace function gen_prefixed_id(p_prefix text, p_bytes int default 12) returns text
language sql volatile as $$
  select p_prefix || encode(gen_random_bytes(p_bytes), 'hex')
$$;

-- ───────────────────────── プロフィール ─────────────────────────
create table if not exists profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email        text,
  country      text not null default 'JP',
  role         text not null default 'user' check (role in ('user','admin')),
  created_at   timestamptz not null default now()
);

-- auth.users 作成時にプロフィールを自動作成
create or replace function handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (user_id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- 管理者ログイン（ID + パスワード）。Supabase Auth を使わないローカル/デモ認証用
create table if not exists admin_credentials (
  login_id      text primary key,
  user_id       uuid not null references profiles(user_id) on delete cascade,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create or replace function admin_login(p_login_id text, p_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cred admin_credentials%rowtype;
  v_profile profiles%rowtype;
begin
  select * into v_cred from admin_credentials where login_id = p_login_id;
  if not found or v_cred.password_hash <> crypt(p_password, v_cred.password_hash) then
    perform app_error('invalid_credentials', 'IDまたはパスワードが正しくありません');
  end if;
  select * into v_profile from profiles where user_id = v_cred.user_id;
  return jsonb_build_object('user_id', v_profile.user_id, 'email', v_profile.email, 'role', v_profile.role);
end $$;

-- ───────────────────────── 台帳 ─────────────────────────
create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  owner_type  text not null check (owner_type in ('user','merchant','system')),
  owner_id    uuid,
  system_code text check (system_code in ('fx_pool','crypto_custody','points_issuer','fee_revenue','card_clearing','bank_clearing')),
  currency    text not null references currencies(code),
  balance     numeric(40,0) not null default 0,   -- post_journal 内でのみ更新（キャッシュ）
  created_at  timestamptz not null default now(),
  constraint accounts_owner_shape check (
    (owner_type = 'system' and owner_id is null and system_code is not null) or
    (owner_type <> 'system' and owner_id is not null and system_code is null)
  ),
  constraint accounts_unique_owner_currency unique nulls not distinct (owner_type, owner_id, system_code, currency)
);
create index if not exists accounts_owner_idx on accounts (owner_type, owner_id);

create table if not exists journal_entries (
  id              uuid primary key default gen_random_uuid(),
  type            text not null,
  idempotency_key text unique,
  reference_type  text,
  reference_id    text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists journal_entries_created_idx on journal_entries (created_at desc, id desc);
create index if not exists journal_entries_reference_idx on journal_entries (reference_type, reference_id);

create table if not exists ledger_lines (
  id         bigserial primary key,
  journal_id uuid not null references journal_entries(id) on delete restrict,
  account_id uuid not null references accounts(id) on delete restrict,
  amount     numeric(40,0) not null,
  currency   text not null references currencies(code)
);
create index if not exists ledger_lines_journal_idx on ledger_lines (journal_id);
create index if not exists ledger_lines_account_idx on ledger_lines (account_id, id desc);

-- 口座を取得（なければ作成）
create or replace function ensure_account(
  p_owner_type text, p_owner_id uuid, p_system_code text, p_currency text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_owner_type not in ('user','merchant','system') then
    perform app_error('invalid_owner_type', '不正な口座種別です', 'owner_type');
  end if;
  if not exists (select 1 from currencies where code = p_currency) then
    perform app_error('invalid_currency', '未対応の通貨です: ' || coalesce(p_currency, 'null'), 'currency');
  end if;
  if p_owner_type = 'system' then
    insert into accounts (owner_type, owner_id, system_code, currency)
    values ('system', null, p_system_code, p_currency)
    on conflict (owner_type, owner_id, system_code, currency) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from accounts
      where owner_type = 'system' and system_code = p_system_code and currency = p_currency;
    end if;
  else
    insert into accounts (owner_type, owner_id, system_code, currency)
    values (p_owner_type, p_owner_id, null, p_currency)
    on conflict (owner_type, owner_id, system_code, currency) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from accounts
      where owner_type = p_owner_type and owner_id = p_owner_id and currency = p_currency;
    end if;
  end if;
  return v_id;
end $$;

-- 仕訳起票（唯一の残高変更経路）
--   p_lines: [{ "account_id": uuid, "currency": "JPY", "amount": "-1500" }]
--            または { "owner_type": "user", "owner_id": uuid, "currency": ..., "amount": ... }
--            または { "system_code": "fx_pool", "currency": ..., "amount": ... }
create or replace function post_journal(
  p_type            text,
  p_idempotency_key text,
  p_lines           jsonb,
  p_reference_type  text  default null,
  p_reference_id    text  default null,
  p_metadata        jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_journal_id uuid;
  v_line       jsonb;
  v_account_id uuid;
  v_amount     numeric;
  v_currency   text;
  v_acc_currency text;
  v_resolved   jsonb := '[]'::jsonb;
begin
  if p_type is null or p_type = '' then
    perform app_error('invalid_journal_type', '仕訳種別が必要です', 'type');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform app_error('invalid_lines', '仕訳行が空です', 'lines');
  end if;

  -- 冪等: 既に同じキーで起票済みなら既存の journal を返す
  if p_idempotency_key is not null then
    select id into v_journal_id from journal_entries where idempotency_key = p_idempotency_key;
    if found then
      return v_journal_id;
    end if;
  end if;

  -- 行の解決（口座IDの決定・検証）
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_currency := v_line->>'currency';
    if v_currency is null or not exists (select 1 from currencies where code = v_currency) then
      perform app_error('invalid_currency', '未対応の通貨です: ' || coalesce(v_currency, 'null'), 'currency');
    end if;
    begin
      v_amount := (v_line->>'amount')::numeric;
    exception when others then
      perform app_error('invalid_amount', '金額が不正です: ' || coalesce(v_line->>'amount', 'null'), 'amount');
    end;
    if v_amount is null or scale(v_amount) <> 0 then
      perform app_error('invalid_amount', '金額は最小単位の整数で指定してください', 'amount');
    end if;

    if v_line ? 'account_id' then
      v_account_id := (v_line->>'account_id')::uuid;
      select currency into v_acc_currency from accounts where id = v_account_id;
      if v_acc_currency is null then
        perform app_error('account_not_found', '口座が見つかりません', 'account_id');
      end if;
      if v_acc_currency <> v_currency then
        perform app_error('currency_mismatch', '口座の通貨と仕訳行の通貨が一致しません', 'currency');
      end if;
    elsif v_line ? 'system_code' then
      v_account_id := ensure_account('system', null, v_line->>'system_code', v_currency);
    else
      v_account_id := ensure_account(v_line->>'owner_type', (v_line->>'owner_id')::uuid, null, v_currency);
    end if;

    v_resolved := v_resolved || jsonb_build_object(
      'account_id', v_account_id, 'currency', v_currency, 'amount', v_amount::text
    );
  end loop;

  -- 不変条件: 通貨ごとの合計 = 0
  if exists (
    select 1
    from jsonb_to_recordset(v_resolved) as x(currency text, amount numeric)
    group by currency
    having sum(amount) <> 0
  ) then
    perform app_error('journal_unbalanced', '仕訳の通貨別合計が 0 ではありません', 'lines');
  end if;

  -- デッドロック回避のため口座を ID 順にロック
  perform 1 from accounts
  where id in (select (x->>'account_id')::uuid from jsonb_array_elements(v_resolved) x)
  order by id
  for update;

  insert into journal_entries (type, idempotency_key, reference_type, reference_id, metadata)
  values (p_type, p_idempotency_key, p_reference_type, p_reference_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning id into v_journal_id;

  if v_journal_id is null then
    -- 同時実行で先に同じキーが起票された
    select id into v_journal_id from journal_entries where idempotency_key = p_idempotency_key;
    return v_journal_id;
  end if;

  insert into ledger_lines (journal_id, account_id, amount, currency)
  select v_journal_id, (x->>'account_id')::uuid, (x->>'amount')::numeric, x->>'currency'
  from jsonb_array_elements(v_resolved) x;

  update accounts a
  set balance = a.balance + s.total
  from (
    select (x->>'account_id')::uuid as account_id, sum((x->>'amount')::numeric) as total
    from jsonb_array_elements(v_resolved) x
    group by 1
  ) s
  where a.id = s.account_id;

  -- 不変条件: ユーザー・加盟店口座は負にならない（違反時は例外でロールバック）
  if exists (
    select 1 from accounts a
    where a.id in (select (x->>'account_id')::uuid from jsonb_array_elements(v_resolved) x)
      and a.owner_type in ('user','merchant')
      and a.balance < 0
  ) then
    perform app_error('insufficient_funds', '残高が不足しています', 'amount');
  end if;

  return v_journal_id;
end $$;

-- 台帳整合性チェック（pnpm ledger:verify と管理画面で使用）
create or replace function ledger_verify() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_unbalanced jsonb;
  v_negative   jsonb;
  v_mismatch   jsonb;
  v_system     jsonb;
  v_journals   bigint;
  v_lines      bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('journal_id', journal_id, 'currency', currency, 'sum', total::text)), '[]'::jsonb)
  into v_unbalanced
  from (
    select journal_id, currency, sum(amount) as total
    from ledger_lines group by journal_id, currency having sum(amount) <> 0
  ) u;

  select coalesce(jsonb_agg(jsonb_build_object('account_id', id, 'owner_type', owner_type, 'owner_id', owner_id, 'currency', currency, 'balance', balance::text)), '[]'::jsonb)
  into v_negative
  from accounts where owner_type in ('user','merchant') and balance < 0;

  select coalesce(jsonb_agg(jsonb_build_object('account_id', a.id, 'currency', a.currency, 'balance', a.balance::text, 'computed', coalesce(l.total, 0)::text)), '[]'::jsonb)
  into v_mismatch
  from accounts a
  left join (select account_id, sum(amount) as total from ledger_lines group by account_id) l on l.account_id = a.id
  where a.balance <> coalesce(l.total, 0);

  select coalesce(jsonb_agg(jsonb_build_object('system_code', system_code, 'currency', currency, 'balance', balance::text) order by system_code, currency), '[]'::jsonb)
  into v_system
  from accounts where owner_type = 'system';

  select count(*) into v_journals from journal_entries;
  select count(*) into v_lines from ledger_lines;

  return jsonb_build_object(
    'ok', (jsonb_array_length(v_unbalanced) = 0 and jsonb_array_length(v_negative) = 0 and jsonb_array_length(v_mismatch) = 0),
    'journal_count', v_journals,
    'line_count', v_lines,
    'unbalanced_journals', v_unbalanced,
    'negative_accounts', v_negative,
    'balance_mismatches', v_mismatch,
    'system_balances', v_system,
    'checked_at', now()
  );
end $$;

-- ───────────────────────── 通知 ─────────────────────────
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- ───────────────────────── 読み取り RPC ─────────────────────────

-- JPY 換算（Phase 2 でレート対応に置き換える。ここでは JPY/PT のみ 1:1）
create or replace function convert_to_jpy(p_currency text, p_amount numeric) returns numeric
language plpgsql stable set search_path = public as $$
begin
  if p_currency in ('JPY', 'PT') then
    return p_amount;
  end if;
  return 0;
end $$;

create or replace function profile_json(p profiles) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'user_id', p.user_id,
    'display_name', p.display_name,
    'email', p.email,
    'country', p.country,
    'role', p.role,
    'created_at', p.created_at
  )
$$;

-- プロフィール取得（なければ作成）
create or replace function ensure_profile(p_user_id uuid, p_email text default null, p_display_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
begin
  insert into profiles (user_id, email, display_name)
  values (p_user_id, p_email, coalesce(p_display_name, split_part(coalesce(p_email, ''), '@', 1)))
  on conflict (user_id) do update
    set email = coalesce(excluded.email, profiles.email)
  returning * into v_profile;
  return profile_json(v_profile);
end $$;

-- 自分の情報 + 全通貨残高
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
    'merchant_ids', '[]'::jsonb
  );
end $$;

create or replace function update_profile(p_user_id uuid, p_display_name text, p_country text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles%rowtype;
begin
  update profiles
  set display_name = coalesce(p_display_name, display_name),
      country = coalesce(p_country, country)
  where user_id = p_user_id
  returning * into v_profile;
  if not found then
    perform app_error('not_found', 'プロフィールが見つかりません');
  end if;
  return profile_json(v_profile);
end $$;

-- 統合取引履歴（journal ベース、カーソルページネーション）
create or replace function list_transactions(
  p_user_id        uuid,
  p_currency       text default null,
  p_limit          int  default 20,
  p_starting_after text default null,
  p_type           text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then
    select created_at, id into v_cursor_created, v_cursor_id
    from journal_entries where id = p_starting_after::uuid;
  end if;

  with my_accounts as (
    select id from accounts where owner_type = 'user' and owner_id = p_user_id
  ),
  js as (
    select j.id, j.type, j.created_at, j.reference_type, j.reference_id, j.metadata
    from journal_entries j
    where exists (
        select 1 from ledger_lines l
        join my_accounts a on a.id = l.account_id
        where l.journal_id = j.id
          and (p_currency is null or l.currency = p_currency)
      )
      and (p_type is null or j.type = p_type)
      and (v_cursor_id is null or (j.created_at, j.id) < (v_cursor_created, v_cursor_id))
    order by j.created_at desc, j.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', js.id,
           'type', js.type,
           'created_at', js.created_at,
           'reference_type', js.reference_type,
           'reference_id', js.reference_id,
           'metadata', js.metadata,
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object('currency', l.currency, 'amount', l.amount::text) order by l.id), '[]'::jsonb)
             from ledger_lines l join my_accounts a on a.id = l.account_id
             where l.journal_id = js.id
           )
         ) order by js.created_at desc, js.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count
  from js;

  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;

  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

-- 通知
create or replace function list_notifications(p_user_id uuid, p_limit int default 20, p_unread_only boolean default false)
returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc)
      from (
        select id, type, title, body, data, read_at, created_at
        from notifications
        where user_id = p_user_id and (not p_unread_only or read_at is null)
        order by created_at desc
        limit least(greatest(coalesce(p_limit, 20), 1), 100)
      ) n
    ), '[]'::jsonb),
    'unread_count', (select count(*) from notifications where user_id = p_user_id and read_at is null)
  )
$$;

drop function if exists mark_notifications_read(uuid, uuid[]);
create or replace function mark_notifications_read(p_user_id uuid, p_ids text[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  update notifications set read_at = now()
  where user_id = p_user_id and read_at is null and (p_ids is null or id = any(p_ids::uuid[]));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── RLS ─────────────────────────
-- フロントは API（service role）経由でアクセスする。テーブルは RLS を有効化し、
-- ユーザーが直接読めるのは自分の行だけにする。
alter table profiles        enable row level security;
alter table accounts        enable row level security;
alter table journal_entries enable row level security;
alter table ledger_lines    enable row level security;
alter table notifications   enable row level security;
alter table admin_credentials enable row level security;
alter table config          enable row level security;
alter table currencies      enable row level security;

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select using (auth.uid() = user_id);
drop policy if exists accounts_self on accounts;
create policy accounts_self on accounts for select using (owner_type = 'user' and owner_id = auth.uid());
drop policy if exists notifications_self on notifications;
create policy notifications_self on notifications for select using (user_id = auth.uid());
drop policy if exists currencies_public on currencies;
create policy currencies_public on currencies for select using (true);

-- RPC は service role からのみ呼ぶ（anon / authenticated には実行権を与えない）
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
