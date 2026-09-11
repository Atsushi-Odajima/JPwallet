-- ============================================================================
-- payCcount 0005: ポイント（PT）
--
-- 1 PT = 1 JPY 相当。決済にのみ使用可（両替・出金・クリプト購入には使えない）。
-- 発行元は points_issuer 勘定。購入代金（JPY）は points_issuer に入り、PT は points_issuer から発行される。
-- ボーナス分は JPY の裏付けなしに points_issuer が発行する（発行元のコスト）。
-- 銀行振込での購入は「入金通知 → 振込識別コード照合」で完了する（Phase 1 の見せ場を再利用）。
-- ============================================================================
set client_min_messages = warning;

insert into currencies (code, kind, decimals, name, sort_order) values
  ('PT', 'points', 0, 'payCcountポイント', 70)
on conflict (code) do nothing;

-- ───────────────────────── キャンペーン ─────────────────────────
create table if not exists point_campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  bonus_rate  numeric(6,4) not null check (bonus_rate >= 0 and bonus_rate <= 1),  -- 0.0100 = +1%
  min_amount  numeric(40,0) not null default 0,
  active_from timestamptz not null default now(),
  active_to   timestamptz not null,
  created_at  timestamptz not null default now()
);

insert into point_campaigns (id, name, bonus_rate, min_amount, active_from, active_to) values
  ('00000000-0000-4000-8000-00000000c001', 'デモ開始キャンペーン +1%', 0.0100, 1000, now() - interval '1 day', now() + interval '365 days'),
  ('00000000-0000-4000-8000-00000000c002', 'まとめ買い +3%（¥10,000 以上）', 0.0300, 10000, now() - interval '1 day', now() + interval '365 days')
on conflict (id) do nothing;

create or replace function point_campaign_json(c point_campaigns) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'bonus_rate', trim_scale(c.bonus_rate)::text, 'min_amount', c.min_amount::text,
    'active_from', c.active_from, 'active_to', c.active_to, 'created_at', c.created_at
  )
$$;

create or replace function list_point_campaigns(p_active_only boolean default true) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(point_campaign_json(c.*) order by c.min_amount, c.bonus_rate desc)
    from point_campaigns c
    where not p_active_only or (c.active_from <= now() and c.active_to >= now())
  ), '[]'::jsonb))
$$;

create or replace function create_point_campaign(p_name text, p_bonus_rate numeric, p_min_amount numeric, p_active_from timestamptz, p_active_to timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_c point_campaigns%rowtype;
begin
  if p_name is null or length(trim(p_name)) = 0 then perform app_error('invalid_request', 'キャンペーン名が必要です', 'name'); end if;
  if p_bonus_rate is null or p_bonus_rate < 0 or p_bonus_rate > 1 then perform app_error('invalid_request', 'bonus_rate は 0〜1 で指定してください', 'bonus_rate'); end if;
  if p_active_to <= coalesce(p_active_from, now()) then perform app_error('invalid_request', 'active_to は active_from より後にしてください', 'active_to'); end if;
  insert into point_campaigns (name, bonus_rate, min_amount, active_from, active_to)
  values (trim(p_name), p_bonus_rate, coalesce(p_min_amount, 0), coalesce(p_active_from, now()), p_active_to)
  returning * into v_c;
  return point_campaign_json(v_c);
end $$;

-- 金額に対して最も有利なキャンペーンを選ぶ
create or replace function pick_point_campaign(p_amount numeric) returns point_campaigns
language sql stable set search_path = public, extensions as $$
  select c.* from point_campaigns c
  where c.active_from <= now() and c.active_to >= now() and c.min_amount <= p_amount
  order by c.bonus_rate desc, c.min_amount desc
  limit 1
$$;

-- ───────────────────────── ポイント購入 ─────────────────────────
create table if not exists point_purchases (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references profiles(user_id) on delete cascade,
  paid_currency      text not null default 'JPY' references currencies(code),
  paid_amount        numeric(40,0) not null check (paid_amount > 0),
  points_granted     numeric(40,0) not null,
  bonus_points       numeric(40,0) not null default 0,
  payment_method     text not null check (payment_method in ('card','bank_transfer','wallet_jpy')),
  status             text not null check (status in ('pending','succeeded','failed')),
  campaign_id        uuid references point_campaigns(id),
  transfer_reference text unique,        -- 銀行振込用の識別コード（振込人名に付ける）
  card_last4         text,
  failure_reason     text,
  journal_id         uuid references journal_entries(id),
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index if not exists point_purchases_user_idx on point_purchases (user_id, created_at desc);

create or replace function point_purchase_json(p point_purchases) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', p.id, 'user_id', p.user_id, 'paid_currency', p.paid_currency, 'paid_amount', p.paid_amount::text,
    'points_granted', p.points_granted::text, 'bonus_points', p.bonus_points::text,
    'payment_method', p.payment_method, 'status', p.status, 'campaign_id', p.campaign_id,
    'transfer_reference', p.transfer_reference, 'card_last4', p.card_last4, 'failure_reason', p.failure_reason,
    'journal_id', p.journal_id, 'created_at', p.created_at, 'completed_at', p.completed_at
  )
$$;

-- 発行仕訳: 資金元 JPY - / points_issuer JPY + / points_issuer PT -granted / user PT +granted
create or replace function post_points_issue_journal(
  p_purchase point_purchases, p_funding_source jsonb, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
begin
  return post_journal(
    'points_purchase',
    p_idempotency_key,
    jsonb_build_array(
      p_funding_source,
      jsonb_build_object('system_code', 'points_issuer', 'currency', 'JPY', 'amount', p_purchase.paid_amount::text),
      jsonb_build_object('system_code', 'points_issuer', 'currency', 'PT', 'amount', (-p_purchase.points_granted)::text),
      jsonb_build_object('owner_type', 'user', 'owner_id', p_purchase.user_id, 'currency', 'PT', 'amount', p_purchase.points_granted::text)
    ),
    'point_purchase', p_purchase.id::text,
    jsonb_build_object('method', p_purchase.payment_method, 'bonus_points', p_purchase.bonus_points::text,
                       'campaign_id', p_purchase.campaign_id, 'description',
                       'ポイント購入（' || case p_purchase.payment_method when 'card' then 'カード' when 'bank_transfer' then '銀行振込' else 'JPY 残高' end
                       || case when p_purchase.bonus_points > 0 then '、ボーナス +' || p_purchase.bonus_points::text || ' PT' else '' end || '）')
  );
end $$;

create or replace function purchase_points(
  p_user_id         uuid,
  p_amount_jpy      numeric,
  p_method          text,
  p_outcome         text default 'succeeded',   -- card のとき API 層が決める
  p_card_last4      text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_campaign point_campaigns;
  v_bonus numeric := 0;
  v_p point_purchases%rowtype;
  v_journal uuid;
  v_ref text;
begin
  if p_method not in ('card','bank_transfer','wallet_jpy') then
    perform app_error('invalid_method', 'method は card / bank_transfer / wallet_jpy のいずれかです', 'method');
  end if;
  if p_amount_jpy is null or p_amount_jpy <= 0 or scale(p_amount_jpy) <> 0 then
    perform app_error('invalid_amount', '金額は 1 以上の整数で指定してください', 'amount_jpy');
  end if;

  -- 冪等
  if p_idempotency_key is not null then
    select p.* into v_p from point_purchases p join journal_entries j on j.id = p.journal_id where j.idempotency_key = p_idempotency_key;
    if found then return point_purchase_json(v_p); end if;
  end if;

  v_campaign := pick_point_campaign(p_amount_jpy);
  if v_campaign.id is not null then
    v_bonus := floor(p_amount_jpy * v_campaign.bonus_rate);
  end if;

  if p_method = 'bank_transfer' then
    -- 振込識別コードを発行し、入金通知の照合で完了させる
    loop
      v_ref := 'PT' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
      exit when not exists (select 1 from point_purchases where transfer_reference = v_ref);
    end loop;
    insert into point_purchases (user_id, paid_amount, points_granted, bonus_points, payment_method, status, campaign_id, transfer_reference)
    values (p_user_id, p_amount_jpy, p_amount_jpy + v_bonus, v_bonus, 'bank_transfer', 'pending', v_campaign.id, v_ref)
    returning * into v_p;
    return point_purchase_json(v_p);
  end if;

  if p_method = 'card' and p_outcome = 'failed' then
    insert into point_purchases (user_id, paid_amount, points_granted, bonus_points, payment_method, status, campaign_id, card_last4, failure_reason)
    values (p_user_id, p_amount_jpy, 0, 0, 'card', 'failed', v_campaign.id, p_card_last4, 'card_declined')
    returning * into v_p;
    return point_purchase_json(v_p);
  end if;

  insert into point_purchases (user_id, paid_amount, points_granted, bonus_points, payment_method, status, campaign_id, card_last4, completed_at)
  values (p_user_id, p_amount_jpy, p_amount_jpy + v_bonus, v_bonus, p_method, 'succeeded', v_campaign.id, p_card_last4, now())
  returning * into v_p;

  v_journal := post_points_issue_journal(
    v_p,
    case when p_method = 'wallet_jpy'
      then jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', 'JPY', 'amount', (-p_amount_jpy)::text)
      else jsonb_build_object('system_code', 'card_clearing', 'currency', 'JPY', 'amount', (-p_amount_jpy)::text) end,
    coalesce(p_idempotency_key, 'point_purchase:' || v_p.id::text)
  );
  update point_purchases set journal_id = v_journal where id = v_p.id returning * into v_p;

  insert into notifications (user_id, type, title, body, data)
  values (p_user_id, 'points_purchase', 'ポイントを付与しました',
          v_p.points_granted::text || ' PT を付与しました' || case when v_bonus > 0 then '（ボーナス +' || v_bonus::text || ' PT を含む）' else '' end,
          jsonb_build_object('purchase_id', v_p.id, 'points', v_p.points_granted::text, 'bonus', v_bonus::text));

  return point_purchase_json(v_p);
end $$;

create or replace function list_point_purchases(p_user_id uuid, p_limit int default 20) returns jsonb
language sql security definer set search_path = public, extensions as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(point_purchase_json(p.*) order by p.created_at desc)
    from (select * from point_purchases where user_id = p_user_id order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) p
  ), '[]'::jsonb), 'has_more', false)
$$;

-- ───────────────────────── 入金通知処理の拡張 ─────────────────────────
-- 振込人名（または p_reference）に含まれる識別コード PTxxxxxxxx が保留中のポイント購入と一致し、
-- 金額も一致すればポイント購入として完了させる。金額が違えば通常のチャージとして処理する。
drop function if exists process_bank_deposit(text, numeric, text, text);
create or replace function process_bank_deposit(
  p_account_number text,
  p_amount         numeric,
  p_payer_name     text default null,
  p_external_ref   text default null,
  p_reference      text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ref     text := coalesce(nullif(p_external_ref, ''), 'dep_' || encode(gen_random_bytes(8), 'hex'));
  v_existing bank_deposit_notifications%rowtype;
  v_va      virtual_bank_accounts%rowtype;
  v_notif   bank_deposit_notifications%rowtype;
  v_topup   topups%rowtype;
  v_journal uuid;
  v_code    text;
  v_pp      point_purchases%rowtype;
  v_note    text;
begin
  -- 冪等チェック
  select * into v_existing from bank_deposit_notifications where external_ref = v_ref;
  if found then
    if v_existing.topup_id is not null then select * into v_topup from topups where id = v_existing.topup_id; end if;
    if v_existing.point_purchase_id is not null then select * into v_pp from point_purchases where id = v_existing.point_purchase_id; end if;
    return jsonb_build_object(
      'status', 'duplicate',
      'notification', bank_deposit_notification_json(v_existing),
      'topup', case when v_topup.id is null then null else topup_json(v_topup) end,
      'point_purchase', case when v_pp.id is null then null else point_purchase_json(v_pp) end
    );
  end if;

  -- 振込先照合
  select * into v_va from virtual_bank_accounts where account_number = p_account_number;
  if not found then
    insert into bank_deposit_notifications (account_number, amount, payer_name, external_ref, status, reject_reason)
    values (coalesce(p_account_number, ''), coalesce(p_amount, 0), p_payer_name, v_ref, 'unmatched', '振込先口座が見つかりません')
    returning * into v_notif;
    return jsonb_build_object('status', 'unmatched', 'notification', bank_deposit_notification_json(v_notif), 'topup', null, 'point_purchase', null);
  end if;

  -- 金額検証
  if p_amount is null or p_amount <= 0 or scale(p_amount) <> 0 then
    insert into bank_deposit_notifications (virtual_account_id, account_number, amount, payer_name, external_ref, status, reject_reason)
    values (v_va.id, p_account_number, coalesce(p_amount, 0), p_payer_name, v_ref, 'rejected', '金額が不正です')
    returning * into v_notif;
    return jsonb_build_object('status', 'rejected', 'notification', bank_deposit_notification_json(v_notif), 'topup', null, 'point_purchase', null);
  end if;

  insert into bank_deposit_notifications (virtual_account_id, account_number, amount, payer_name, external_ref, status)
  values (v_va.id, p_account_number, p_amount, p_payer_name, v_ref, 'processed')
  returning * into v_notif;

  -- ポイント購入の識別コード照合（p_reference 優先、無ければ振込人名から抽出）
  v_code := upper(coalesce(nullif(trim(p_reference), ''), substring(upper(coalesce(p_payer_name, '')) from 'PT[0-9A-F]{8}')));
  if v_code is not null then
    select * into v_pp from point_purchases
    where transfer_reference = v_code and user_id = v_va.user_id and status = 'pending'
    for update;
    if found then
      if v_pp.paid_amount = p_amount then
        v_journal := post_points_issue_journal(
          v_pp,
          jsonb_build_object('system_code', 'bank_clearing', 'currency', 'JPY', 'amount', (-p_amount)::text),
          'bank_deposit:' || v_ref
        );
        update point_purchases set status = 'succeeded', journal_id = v_journal, completed_at = now() where id = v_pp.id returning * into v_pp;
        update bank_deposit_notifications set processed_at = now(), point_purchase_id = v_pp.id where id = v_notif.id returning * into v_notif;
        insert into notifications (user_id, type, title, body, data)
        values (v_va.user_id, 'points_purchase', '振込を確認し、ポイントを付与しました',
                '¥' || to_char(p_amount, 'FM999,999,999,999') || ' の振込（' || v_code || '）に対して ' || v_pp.points_granted::text || ' PT を付与しました',
                jsonb_build_object('purchase_id', v_pp.id, 'points', v_pp.points_granted::text, 'external_ref', v_ref));
        return jsonb_build_object('status', 'processed', 'notification', bank_deposit_notification_json(v_notif), 'topup', null, 'point_purchase', point_purchase_json(v_pp));
      else
        v_note := 'ポイント購入 ' || v_code || ' と金額が一致しないため、通常のチャージとして処理しました';
        v_pp := null;
      end if;
    end if;
  end if;

  -- 通常のチャージ
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
    jsonb_build_object('method', 'bank_transfer', 'payer_name', p_payer_name, 'external_ref', v_ref, 'note', v_note,
                       'description', '銀行振込（' || coalesce(p_payer_name, '振込人不明') || '）')
  );
  update topups set journal_id = v_journal where id = v_topup.id returning * into v_topup;
  update bank_deposit_notifications set processed_at = now(), topup_id = v_topup.id where id = v_notif.id returning * into v_notif;

  insert into notifications (user_id, type, title, body, data)
  values (v_va.user_id, 'topup_bank', '入金を確認しました',
          '¥' || to_char(p_amount, 'FM999,999,999,999') || ' の振込（' || coalesce(p_payer_name, '振込人不明') || '）を残高に反映しました' || coalesce('。' || v_note, ''),
          jsonb_build_object('topup_id', v_topup.id, 'amount', p_amount::text, 'currency', 'JPY', 'payer_name', p_payer_name));

  return jsonb_build_object(
    'status', 'processed',
    'notification', bank_deposit_notification_json(v_notif),
    'topup', topup_json(v_topup),
    'point_purchase', null,
    'note', v_note
  );
end $$;

-- ───────────────────────── RLS ─────────────────────────
alter table point_campaigns enable row level security;
alter table point_purchases enable row level security;
drop policy if exists point_campaigns_public on point_campaigns;
create policy point_campaigns_public on point_campaigns for select using (true);
drop policy if exists point_purchases_self on point_purchases;
create policy point_purchases_self on point_purchases for select using (user_id = auth.uid());

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
