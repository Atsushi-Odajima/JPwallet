-- ============================================================================
-- payCcount 0007: 管理者（運営）向け参照 RPC
-- 管理者ロール（profiles.role = 'admin'）の JWT でのみ API から呼ばれる。全データを閲覧できる。
-- ============================================================================
set client_min_messages = warning;

-- 口座の持ち主を表示用に解決する
create or replace function account_owner_label(a accounts) returns text
language sql stable set search_path = public, extensions as $$
  select case a.owner_type
    when 'system' then 'system:' || a.system_code
    when 'user' then coalesce((select coalesce(display_name, email) from profiles where user_id = a.owner_id), a.owner_id::text)
    when 'merchant' then coalesce((select name from merchants where id = a.owner_id), a.owner_id::text)
  end
$$;

-- 概要
create or replace function admin_overview() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'users', (select count(*) from profiles),
      'merchants', (select count(*) from merchants),
      'payments', (select count(*) from payments),
      'refunds', (select count(*) from refunds),
      'journals', (select count(*) from journal_entries),
      'open_sessions', (select count(*) from checkout_sessions where status = 'open' and expires_at > now()),
      'webhook_pending', (select count(*) from webhook_deliveries where status in ('pending','in_flight')),
      'webhook_failed', (select count(*) from webhook_deliveries where status = 'failed')
    ),
    'volume_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object('currency', settlement_currency, 'count', n, 'gross', gross::text, 'fees', fees::text, 'refunded', refunded::text) order by settlement_currency)
      from (select settlement_currency, count(*) n, sum(settlement_amount) gross, sum(fee_amount) fees, sum(refunded_amount) refunded from payments group by settlement_currency) v
    ), '[]'::jsonb),
    'user_balances_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'total', total::text, 'accounts', n) order by currency)
      from (select currency, sum(balance) total, count(*) n from accounts where owner_type = 'user' group by currency) u
    ), '[]'::jsonb),
    'merchant_balances_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'total', total::text, 'accounts', n) order by currency)
      from (select currency, sum(balance) total, count(*) n from accounts where owner_type = 'merchant' group by currency) m
    ), '[]'::jsonb),
    'system_balances', coalesce((
      select jsonb_agg(jsonb_build_object('system_code', system_code, 'currency', currency, 'balance', balance::text) order by system_code, currency)
      from accounts where owner_type = 'system'
    ), '[]'::jsonb),
    'rates', (list_rates())->'data',
    'ledger', ledger_verify(),
    'recent_journals', (admin_list_journals(8, null, null))->'data'
  );
end $$;

-- ユーザー一覧（残高付き）
create or replace function admin_list_users(p_limit int default 50, p_search text default null) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'email', p.email, 'display_name', p.display_name, 'role', p.role, 'country', p.country, 'created_at', p.created_at,
      'balances', coalesce((select jsonb_object_agg(a.currency, a.balance::text) from accounts a where a.owner_type = 'user' and a.owner_id = p.user_id), '{}'::jsonb),
      'total_jpy', coalesce((select sum(convert_to_jpy(a.currency, a.balance)) from accounts a where a.owner_type = 'user' and a.owner_id = p.user_id), 0)::text,
      'merchants', (select count(*) from merchants m where m.owner_user_id = p.user_id),
      'payments', (select count(*) from payments x where x.payer_user_id = p.user_id)
    ) order by p.created_at desc)
    from (
      select * from profiles
      where p_search is null or p_search = '' or email ilike '%' || p_search || '%' or display_name ilike '%' || p_search || '%'
      order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 500)
    ) p
  ), '[]'::jsonb))
$$;

-- ユーザー詳細
create or replace function admin_get_user(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from profiles where user_id = p_user_id) then perform app_error('not_found', 'ユーザーが見つかりません'); end if;
  return jsonb_build_object(
    'me', get_me(p_user_id),
    'transactions', (list_transactions(p_user_id, null, 30, null, null))->'data',
    'merchants', (list_my_merchants(p_user_id))->'data',
    'virtual_bank_account', (select virtual_bank_account_json(v.*) from virtual_bank_accounts v where v.user_id = p_user_id),
    'notifications', (list_notifications(p_user_id, 10, false))->'data'
  );
end $$;

-- 仕訳ブラウザ（行に口座の持ち主を付ける）
create or replace function admin_list_journals(p_limit int default 20, p_starting_after text default null, p_type text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_cursor journal_entries%rowtype;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then
    select * into v_cursor from journal_entries where id = p_starting_after::uuid;
  end if;
  with js as (
    select j.* from journal_entries j
    where (p_type is null or j.type = p_type)
      and (v_cursor.id is null or (j.created_at, j.id) < (v_cursor.created_at, v_cursor.id))
    order by j.created_at desc, j.id desc
    limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', js.id, 'type', js.type, 'created_at', js.created_at, 'idempotency_key', js.idempotency_key,
           'reference_type', js.reference_type, 'reference_id', js.reference_id, 'metadata', js.metadata,
           'lines', (
             select coalesce(jsonb_agg(jsonb_build_object(
               'account_id', l.account_id, 'owner_type', a.owner_type, 'owner', account_owner_label(a.*),
               'currency', l.currency, 'amount', l.amount::text
             ) order by l.id), '[]'::jsonb)
             from ledger_lines l join accounts a on a.id = l.account_id where l.journal_id = js.id
           )
         ) order by js.created_at desc, js.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from js;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;
  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

-- 全口座
create or replace function admin_list_accounts() returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'owner_type', a.owner_type, 'owner_id', a.owner_id, 'system_code', a.system_code, 'owner', account_owner_label(a.*),
      'currency', a.currency, 'balance', a.balance::text, 'created_at', a.created_at
    ) order by a.owner_type, a.system_code, account_owner_label(a.*), a.currency)
    from accounts a
  ), '[]'::jsonb))
$$;

-- 全決済
create or replace function admin_list_payments(p_limit int default 50, p_starting_after text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_cursor payments%rowtype;
  v_rows jsonb;
  v_count int;
begin
  if p_starting_after is not null then select * into v_cursor from payments where id = p_starting_after; end if;
  with rows as (
    select p.* from payments p
    where (v_cursor.id is null or (p.created_at, p.id) < (v_cursor.created_at, v_cursor.id))
    order by p.created_at desc, p.id desc limit v_limit + 1
  )
  select coalesce(jsonb_agg((payment_json(rows.*) || jsonb_build_object(
           'merchant_name', (select name from merchants where id = rows.merchant_id),
           'payer_email', (select email from profiles where user_id = rows.payer_user_id)
         )) order by rows.created_at desc, rows.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count from rows;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(x) from (select x from jsonb_array_elements(v_rows) x limit v_limit) t);
  end if;
  return jsonb_build_object('data', coalesce(v_rows, '[]'::jsonb), 'has_more', v_count > v_limit);
end $$;

-- Webhook 配信（全加盟店）
create or replace function admin_list_webhook_deliveries(p_limit int default 50, p_status text default null) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg((webhook_delivery_json(d.*) || jsonb_build_object(
      'merchant_id', d.merchant_id,
      'merchant_name', (select name from merchants where id = d.merchant_id),
      'event_type', (select type from webhook_events where id = d.event_id)
    )) order by d.updated_at desc)
    from (
      select * from webhook_deliveries where p_status is null or status = p_status
      order by updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) d
  ), '[]'::jsonb))
$$;

-- 監査ログ
create or replace function admin_list_audit_logs(p_limit int default 100) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(jsonb_build_object('id', l.id, 'actor_type', l.actor_type, 'actor_id', l.actor_id, 'action', l.action,
                                        'target_type', l.target_type, 'target_id', l.target_id, 'metadata', l.metadata, 'created_at', l.created_at)
                     order by l.id desc)
    from (select * from audit_logs order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) l
  ), '[]'::jsonb))
$$;

-- 全 Checkout Session
create or replace function admin_list_checkout_sessions(p_limit int default 50) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg((checkout_session_json(s.*, null) || jsonb_build_object('merchant_name', (select name from merchants where id = s.merchant_id))) order by s.created_at desc)
    from (select * from checkout_sessions order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) s
  ), '[]'::jsonb))
$$;

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
