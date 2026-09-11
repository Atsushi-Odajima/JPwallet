-- ============================================================================
-- payCcount 0004: クリプト（BTC / ETH の模擬カストディ）
--
-- 売買は crypto_custody 勘定と即時約定（成行）。スプレッド分は crypto_custody に残る。
-- 入出金はすべて模擬（fake tx hash）。実際のブロックチェーンには接続しない。
-- ============================================================================
set client_min_messages = warning;

insert into currencies (code, kind, decimals, name, sort_order) values
  ('BTC', 'crypto', 8,  'ビットコイン', 50),
  ('ETH', 'crypto', 18, 'イーサリアム', 60)
on conflict (code) do nothing;

insert into rates (base, quote, rate, source) values
  ('BTC', 'JPY', 15000000.000000000000, 'seed'),
  ('ETH', 'JPY',   500000.000000000000, 'seed')
on conflict (base, quote) do nothing;

-- ───────────────────────── テーブル ─────────────────────────
create table if not exists crypto_orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(user_id) on delete cascade,
  side           text not null check (side in ('buy','sell')),
  asset          text not null references currencies(code),
  quote_currency text not null default 'JPY' references currencies(code),
  asset_amount   numeric(40,0) not null check (asset_amount > 0),
  quote_amount   numeric(40,0) not null check (quote_amount > 0),
  price          numeric(30,12) not null,   -- 実効価格（1 asset あたりの quote、スプレッド込み）
  mid_price      numeric(30,12) not null,
  spread_bps     int not null,
  status         text not null default 'filled' check (status in ('filled','failed')),
  journal_id     uuid references journal_entries(id),
  created_at     timestamptz not null default now()
);
create index if not exists crypto_orders_user_idx on crypto_orders (user_id, created_at desc);

create table if not exists crypto_deposit_addresses (
  user_id    uuid not null references profiles(user_id) on delete cascade,
  asset      text not null references currencies(code),
  address    text not null unique,
  created_at timestamptz not null default now(),
  primary key (user_id, asset)
);

create table if not exists crypto_withdrawals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(user_id) on delete cascade,
  asset        text not null references currencies(code),
  amount       numeric(40,0) not null check (amount > 0),
  to_address   text not null,
  fake_tx_hash text not null,
  status       text not null default 'confirmed' check (status in ('pending','confirmed','failed')),
  journal_id   uuid references journal_entries(id),
  created_at   timestamptz not null default now()
);
create index if not exists crypto_withdrawals_user_idx on crypto_withdrawals (user_id, created_at desc);

create table if not exists crypto_deposits (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(user_id) on delete cascade,
  asset        text not null references currencies(code),
  amount       numeric(40,0) not null check (amount > 0),
  to_address   text not null,
  from_address text,
  fake_tx_hash text not null unique,
  status       text not null default 'confirmed',
  journal_id   uuid references journal_entries(id),
  created_at   timestamptz not null default now()
);
create index if not exists crypto_deposits_user_idx on crypto_deposits (user_id, created_at desc);

-- ───────────────────────── JSON ─────────────────────────
create or replace function crypto_order_json(o crypto_orders) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', o.id, 'user_id', o.user_id, 'side', o.side, 'asset', o.asset, 'quote_currency', o.quote_currency,
    'asset_amount', o.asset_amount::text, 'quote_amount', o.quote_amount::text,
    'price', trim_scale(o.price)::text, 'mid_price', trim_scale(o.mid_price)::text, 'spread_bps', o.spread_bps,
    'status', o.status, 'journal_id', o.journal_id, 'created_at', o.created_at
  )
$$;

create or replace function crypto_withdrawal_json(w crypto_withdrawals) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', w.id, 'user_id', w.user_id, 'asset', w.asset, 'amount', w.amount::text, 'to_address', w.to_address,
    'fake_tx_hash', w.fake_tx_hash, 'status', w.status, 'journal_id', w.journal_id, 'created_at', w.created_at
  )
$$;

create or replace function crypto_deposit_json(d crypto_deposits) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'id', d.id, 'user_id', d.user_id, 'asset', d.asset, 'amount', d.amount::text, 'to_address', d.to_address,
    'from_address', d.from_address, 'fake_tx_hash', d.fake_tx_hash, 'status', d.status, 'journal_id', d.journal_id, 'created_at', d.created_at
  )
$$;

-- ───────────────────────── 価格 ─────────────────────────
create or replace function get_crypto_prices() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_spread int := cfg_int('crypto_spread_bps', 100);
  v_btc numeric := get_rate('BTC', 'JPY');
  v_eth numeric := get_rate('ETH', 'JPY');
  v_at timestamptz;
begin
  select max(fetched_at) into v_at from rates where base in ('BTC','ETH');
  return jsonb_build_object(
    'BTC', jsonb_build_object('JPY', trim_scale(v_btc)::text),
    'ETH', jsonb_build_object('JPY', trim_scale(v_eth)::text),
    'spread_bps', v_spread,
    'detail', jsonb_build_object(
      'BTC', jsonb_build_object('mid', trim_scale(v_btc)::text, 'buy', trim_scale(v_btc * (1 + v_spread::numeric / 10000))::text, 'sell', trim_scale(v_btc * (1 - v_spread::numeric / 10000))::text),
      'ETH', jsonb_build_object('mid', trim_scale(v_eth)::text, 'buy', trim_scale(v_eth * (1 + v_spread::numeric / 10000))::text, 'sell', trim_scale(v_eth * (1 - v_spread::numeric / 10000))::text)
    ),
    'fetched_at', coalesce(v_at, now())
  );
end $$;

-- ───────────────────────── 売買（成行・即時約定） ─────────────────────────
-- buy : user JPY -q / crypto_custody JPY +q / crypto_custody asset -a / user asset +a
-- sell: 逆
create or replace function create_crypto_order(
  p_user_id        uuid,
  p_side           text,
  p_asset          text,
  p_quote_currency text default 'JPY',
  p_asset_amount   numeric default null,
  p_quote_amount   numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_asset currencies%rowtype;
  v_mid numeric;
  v_spread int := cfg_int('crypto_spread_bps', 100);
  v_price numeric;
  v_asset_amount numeric;
  v_quote_amount numeric;
  v_order crypto_orders%rowtype;
  v_journal uuid;
  v_type text;
begin
  select * into v_asset from currencies where code = p_asset and kind = 'crypto';
  if v_asset.code is null then
    perform app_error('invalid_asset', 'BTC または ETH を指定してください', 'asset');
  end if;
  if coalesce(p_quote_currency, 'JPY') <> 'JPY' then
    perform app_error('unsupported_currency', 'クリプトの売買は JPY 建てのみ対応しています', 'quote_currency');
  end if;
  if p_side not in ('buy','sell') then
    perform app_error('invalid_side', 'side は buy または sell です', 'side');
  end if;
  if (p_asset_amount is null) = (p_quote_amount is null) then
    perform app_error('invalid_amount', 'asset_amount か quote_amount のどちらか一方を指定してください', 'asset_amount');
  end if;
  if (p_asset_amount is not null and (p_asset_amount <= 0 or scale(p_asset_amount) <> 0))
     or (p_quote_amount is not null and (p_quote_amount <= 0 or scale(p_quote_amount) <> 0)) then
    perform app_error('invalid_amount', '金額は 1 以上の整数（最小単位）で指定してください', 'amount');
  end if;

  v_mid := get_rate(p_asset, 'JPY');
  if v_mid is null then
    perform app_error('rate_not_found', '価格が見つかりません', 'asset');
  end if;
  v_price := case when p_side = 'buy' then v_mid * (1 + v_spread::numeric / 10000) else v_mid * (1 - v_spread::numeric / 10000) end;

  if p_asset_amount is not null then
    v_asset_amount := p_asset_amount;
    -- buy: 必要な JPY は切り上げ、sell: 受け取る JPY は切り捨て
    v_quote_amount := case when p_side = 'buy'
      then convert_minor_ceil(v_asset_amount, p_asset, 'JPY', v_price)
      else convert_minor(v_asset_amount, p_asset, 'JPY', v_price) end;
  else
    v_quote_amount := p_quote_amount;
    -- buy: 受け取る資産は切り捨て、sell: 必要な資産は切り上げ
    v_asset_amount := case when p_side = 'buy'
      then convert_minor_div(v_quote_amount, 'JPY', p_asset, v_price)
      else convert_minor_div_ceil(v_quote_amount, 'JPY', p_asset, v_price) end;
  end if;
  if v_asset_amount is null or v_asset_amount <= 0 or v_quote_amount is null or v_quote_amount <= 0 then
    perform app_error('amount_too_small', '数量が小さすぎます', 'amount');
  end if;

  insert into crypto_orders (user_id, side, asset, quote_currency, asset_amount, quote_amount, price, mid_price, spread_bps)
  values (p_user_id, p_side, p_asset, 'JPY', v_asset_amount, v_quote_amount, v_price, v_mid, v_spread)
  returning * into v_order;

  v_type := case when p_side = 'buy' then 'crypto_buy' else 'crypto_sell' end;
  v_journal := post_journal(
    v_type,
    'crypto_order:' || v_order.id::text,
    case when p_side = 'buy' then jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', 'JPY', 'amount', (-v_quote_amount)::text),
      jsonb_build_object('system_code', 'crypto_custody', 'currency', 'JPY', 'amount', v_quote_amount::text),
      jsonb_build_object('system_code', 'crypto_custody', 'currency', p_asset, 'amount', (-v_asset_amount)::text),
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', p_asset, 'amount', v_asset_amount::text)
    ) else jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', p_asset, 'amount', (-v_asset_amount)::text),
      jsonb_build_object('system_code', 'crypto_custody', 'currency', p_asset, 'amount', v_asset_amount::text),
      jsonb_build_object('system_code', 'crypto_custody', 'currency', 'JPY', 'amount', (-v_quote_amount)::text),
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', 'JPY', 'amount', v_quote_amount::text)
    ) end,
    'crypto_order', v_order.id::text,
    jsonb_build_object('side', p_side, 'asset', p_asset, 'price', trim_scale(v_price)::text, 'mid_price', trim_scale(v_mid)::text,
                       'spread_bps', v_spread, 'description', p_asset || ' ' || case when p_side = 'buy' then '購入' else '売却' end)
  );
  update crypto_orders set journal_id = v_journal where id = v_order.id returning * into v_order;
  return crypto_order_json(v_order);
end $$;

create or replace function list_crypto_orders(p_user_id uuid, p_limit int default 20) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(crypto_order_json(o.*) order by o.created_at desc)
    from (select * from crypto_orders where user_id = p_user_id order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) o
  ), '[]'::jsonb), 'has_more', false)
$$;

-- ───────────────────────── 模擬入金アドレス ─────────────────────────
-- ユーザー × 資産ごとに決定的な偽アドレスを生成して保存する
create or replace function get_crypto_deposit_address(p_user_id uuid, p_asset text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_addr text;
  v_hash text;
begin
  if not exists (select 1 from currencies where code = p_asset and kind = 'crypto') then
    perform app_error('invalid_asset', 'BTC または ETH を指定してください', 'asset');
  end if;
  select address into v_addr from crypto_deposit_addresses where user_id = p_user_id and asset = p_asset;
  if v_addr is null then
    v_hash := encode(digest(p_user_id::text || ':' || p_asset || ':payccount-demo', 'sha256'), 'hex');
    v_addr := case when p_asset = 'BTC' then 'bc1q' || substr(v_hash, 1, 38) else '0x' || substr(v_hash, 1, 40) end;
    insert into crypto_deposit_addresses (user_id, asset, address) values (p_user_id, p_asset, v_addr)
    on conflict (user_id, asset) do update set address = crypto_deposit_addresses.address
    returning address into v_addr;
  end if;
  return jsonb_build_object('asset', p_asset, 'address', v_addr, 'network', case when p_asset = 'BTC' then 'bitcoin-demo' else 'ethereum-demo' end, 'demo', true);
end $$;

-- 模擬入金（/mock/crypto/deposit）: user asset + / crypto_custody asset -
create or replace function process_crypto_deposit(p_asset text, p_to_address text, p_amount numeric, p_tx_hash text default null, p_from_address text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_hash text := coalesce(nullif(p_tx_hash, ''), case when p_asset = 'ETH' then '0x' else '' end || encode(gen_random_bytes(32), 'hex'));
  v_dep crypto_deposits%rowtype;
  v_journal uuid;
begin
  select * into v_dep from crypto_deposits where fake_tx_hash = v_hash;
  if found then
    return jsonb_build_object('status', 'duplicate', 'deposit', crypto_deposit_json(v_dep));
  end if;
  select user_id into v_user from crypto_deposit_addresses where address = p_to_address and asset = p_asset;
  if v_user is null then
    perform app_error('address_not_found', '入金アドレスが見つかりません', 'to_address');
  end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) <> 0 then
    perform app_error('invalid_amount', '数量は 1 以上の整数（最小単位）で指定してください', 'amount');
  end if;

  insert into crypto_deposits (user_id, asset, amount, to_address, from_address, fake_tx_hash)
  values (v_user, p_asset, p_amount, p_to_address, p_from_address, v_hash)
  returning * into v_dep;

  v_journal := post_journal(
    'crypto_deposit', 'crypto_deposit:' || v_hash,
    jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', v_user, 'currency', p_asset, 'amount', p_amount::text),
      jsonb_build_object('system_code', 'crypto_custody', 'currency', p_asset, 'amount', (-p_amount)::text)
    ),
    'crypto_deposit', v_dep.id::text,
    jsonb_build_object('asset', p_asset, 'tx_hash', v_hash, 'description', p_asset || ' 入金（模擬）')
  );
  update crypto_deposits set journal_id = v_journal where id = v_dep.id returning * into v_dep;

  insert into notifications (user_id, type, title, body, data)
  values (v_user, 'crypto_deposit', p_asset || ' の入金を確認しました', '模擬ネットワーク上で入金が確認され、残高に反映しました',
          jsonb_build_object('deposit_id', v_dep.id, 'asset', p_asset, 'amount', p_amount::text, 'tx_hash', v_hash));

  return jsonb_build_object('status', 'processed', 'deposit', crypto_deposit_json(v_dep));
end $$;

create or replace function list_crypto_deposits(p_user_id uuid, p_limit int default 20) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(crypto_deposit_json(d.*) order by d.created_at desc)
    from (select * from crypto_deposits where user_id = p_user_id order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) d
  ), '[]'::jsonb), 'has_more', false)
$$;

-- ───────────────────────── 模擬出金 ─────────────────────────
-- TODO(real): 実際のブロックチェーン送金はスコープ外。fake_tx_hash を返すだけ
create or replace function create_crypto_withdrawal(p_user_id uuid, p_asset text, p_amount numeric, p_to_address text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w crypto_withdrawals%rowtype;
  v_hash text;
  v_journal uuid;
begin
  if not exists (select 1 from currencies where code = p_asset and kind = 'crypto') then
    perform app_error('invalid_asset', 'BTC または ETH を指定してください', 'asset');
  end if;
  if p_amount is null or p_amount <= 0 or scale(p_amount) <> 0 then
    perform app_error('invalid_amount', '数量は 1 以上の整数（最小単位）で指定してください', 'amount');
  end if;
  if p_asset = 'BTC' and p_to_address !~ '^(bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$' then
    perform app_error('invalid_address', 'BTC アドレスの形式が正しくありません', 'to_address');
  end if;
  if p_asset = 'ETH' and p_to_address !~ '^0x[0-9a-fA-F]{40}$' then
    perform app_error('invalid_address', 'ETH アドレスの形式が正しくありません', 'to_address');
  end if;

  v_hash := case when p_asset = 'ETH' then '0x' else '' end || encode(gen_random_bytes(32), 'hex');

  insert into crypto_withdrawals (user_id, asset, amount, to_address, fake_tx_hash, status)
  values (p_user_id, p_asset, p_amount, p_to_address, v_hash, 'confirmed')
  returning * into v_w;

  v_journal := post_journal(
    'crypto_withdrawal', 'crypto_withdrawal:' || v_w.id::text,
    jsonb_build_array(
      jsonb_build_object('owner_type', 'user', 'owner_id', p_user_id, 'currency', p_asset, 'amount', (-p_amount)::text),
      jsonb_build_object('system_code', 'crypto_custody', 'currency', p_asset, 'amount', p_amount::text)
    ),
    'crypto_withdrawal', v_w.id::text,
    jsonb_build_object('asset', p_asset, 'to_address', p_to_address, 'tx_hash', v_hash, 'description', p_asset || ' 出金（模擬）')
  );
  update crypto_withdrawals set journal_id = v_journal where id = v_w.id returning * into v_w;

  insert into notifications (user_id, type, title, body, data)
  values (p_user_id, 'crypto_withdrawal', p_asset || ' の出金を送信しました（模擬）', '宛先: ' || p_to_address,
          jsonb_build_object('withdrawal_id', v_w.id, 'asset', p_asset, 'amount', p_amount::text, 'tx_hash', v_hash));

  return crypto_withdrawal_json(v_w);
end $$;

create or replace function list_crypto_withdrawals(p_user_id uuid, p_limit int default 20) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('data', coalesce((
    select jsonb_agg(crypto_withdrawal_json(w.*) order by w.created_at desc)
    from (select * from crypto_withdrawals where user_id = p_user_id order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) w
  ), '[]'::jsonb), 'has_more', false)
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table crypto_orders enable row level security;
alter table crypto_deposit_addresses enable row level security;
alter table crypto_withdrawals enable row level security;
alter table crypto_deposits enable row level security;
drop policy if exists crypto_orders_self on crypto_orders;
create policy crypto_orders_self on crypto_orders for select using (user_id = auth.uid());
drop policy if exists crypto_withdrawals_self on crypto_withdrawals;
create policy crypto_withdrawals_self on crypto_withdrawals for select using (user_id = auth.uid());
drop policy if exists crypto_deposits_self on crypto_deposits;
create policy crypto_deposits_self on crypto_deposits for select using (user_id = auth.uid());

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
