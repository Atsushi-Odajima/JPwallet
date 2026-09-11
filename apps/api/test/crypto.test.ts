import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, createUser, fundUser, ledgerVerify, type TestContext } from './helpers';

async function balance(ctx: TestContext, token: string, currency: string): Promise<string> {
  const r = await api(ctx, 'GET', '/me', { token });
  return r.json.wallets.find((w: { currency: string }) => w.currency === currency).balance;
}

describe('クリプト', () => {
  let ctx: TestContext;
  let user: { id: string; token: string };
  beforeAll(async () => {
    ctx = createTestContext();
    user = await createUser(ctx);
    await fundUser(ctx, user.id, 'JPY', '1000000');
    await api(ctx, 'POST', '/mock/rates/refresh');
  });
  afterAll(() => ctx.close());

  it('価格（認証なし）: ミッド・買値・売値', async () => {
    const r = await api(ctx, 'GET', '/crypto/prices');
    expect(r.status).toBe(200);
    expect(r.json.BTC.JPY).toBe('15000000');
    expect(r.json.ETH.JPY).toBe('500000');
    expect(r.json.spread_bps).toBe(100);
    expect(r.json.detail.BTC.buy).toBe('15150000');
    expect(r.json.detail.BTC.sell).toBe('14850000');
  });

  it('BTC を 0.001 購入: 15,150,000 × 0.001 = ¥15,150', async () => {
    const r = await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'buy', asset: 'BTC', quote_currency: 'JPY', asset_amount: '100000' } });
    expect(r.status).toBe(201);
    expect(r.json.quote_amount).toBe('15150');
    expect(r.json.price).toBe('15150000');
    expect(r.json.status).toBe('filled');
    expect(await balance(ctx, user.token, 'BTC')).toBe('100000');
    expect(await balance(ctx, user.token, 'JPY')).toBe('984850');
  });

  it('JPY 指定で ETH を購入: ¥50,500 → 0.1 ETH（wei）', async () => {
    const r = await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'buy', asset: 'ETH', quote_amount: '50500' } });
    expect(r.status).toBe(201);
    // 50500 / 505000 = 0.1 ETH = 100000000000000000 wei
    expect(r.json.asset_amount).toBe('100000000000000000');
    expect(await balance(ctx, user.token, 'ETH')).toBe('100000000000000000');
  });

  it('BTC を売却: 0.0005 × 14,850,000 = ¥7,425', async () => {
    const r = await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'sell', asset: 'BTC', asset_amount: '50000' } });
    expect(r.status).toBe(201);
    expect(r.json.quote_amount).toBe('7425');
    expect(await balance(ctx, user.token, 'BTC')).toBe('50000');
  });

  it('残高不足は 402', async () => {
    const r = await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'sell', asset: 'BTC', asset_amount: '100000000' } });
    expect(r.status).toBe(402);
    const r2 = await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'buy', asset: 'BTC', asset_amount: '100000000' } });
    expect(r2.status).toBe(402);
  });

  it('両方の金額指定・不正資産は 400', async () => {
    expect((await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'buy', asset: 'BTC', asset_amount: '1', quote_amount: '1' } })).status).toBe(400);
    expect((await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'buy', asset: 'DOGE', asset_amount: '1' } })).status).toBe(400);
  });

  it('入金アドレスは決定的で、模擬入金で残高が増える（冪等）', async () => {
    const a = await api(ctx, 'GET', '/me/crypto/deposit-address?asset=BTC', { token: user.token });
    expect(a.json.address).toMatch(/^bc1q[0-9a-f]{38}$/);
    const b = await api(ctx, 'GET', '/me/crypto/deposit-address?asset=BTC', { token: user.token });
    expect(b.json.address).toBe(a.json.address);
    const e = await api(ctx, 'GET', '/me/crypto/deposit-address?asset=ETH', { token: user.token });
    expect(e.json.address).toMatch(/^0x[0-9a-f]{40}$/);

    const dep = await api(ctx, 'POST', '/mock/crypto/deposit', { body: { asset: 'BTC', to_address: a.json.address, amount: '25000', tx_hash: 'txhash-001' } });
    expect(dep.status).toBe(201);
    expect(dep.json.status).toBe('processed');
    expect(await balance(ctx, user.token, 'BTC')).toBe('75000');
    const dup = await api(ctx, 'POST', '/mock/crypto/deposit', { body: { asset: 'BTC', to_address: a.json.address, amount: '25000', tx_hash: 'txhash-001' } });
    expect(dup.status).toBe(200);
    expect(dup.json.status).toBe('duplicate');
    expect(await balance(ctx, user.token, 'BTC')).toBe('75000');
    const unknown = await api(ctx, 'POST', '/mock/crypto/deposit', { body: { asset: 'BTC', to_address: 'bc1qunknownaddress0000000000000000000000000', amount: '1' } });
    expect(unknown.status).toBe(400);
  });

  it('模擬出金: fake tx hash が返り残高が減る', async () => {
    const r = await api(ctx, 'POST', '/me/crypto/withdrawals', {
      token: user.token,
      body: { asset: 'ETH', amount: '10000000000000000', to_address: '0x' + 'ab'.repeat(20) },
    });
    expect(r.status).toBe(201);
    expect(r.json.fake_tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.json.status).toBe('confirmed');
    expect(await balance(ctx, user.token, 'ETH')).toBe('90000000000000000');
    const bad = await api(ctx, 'POST', '/me/crypto/withdrawals', { token: user.token, body: { asset: 'ETH', amount: '1', to_address: 'not-an-address' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('invalid_address');
    const list = await api(ctx, 'GET', '/me/crypto/withdrawals', { token: user.token });
    expect(list.json.data).toHaveLength(1);
  });

  it('価格を動かすと約定価格が変わる', async () => {
    await api(ctx, 'POST', '/mock/crypto/set-price', { body: { asset: 'BTC', quote: 'JPY', price: '10000000' } });
    const r = await api(ctx, 'POST', '/me/crypto/orders', { token: user.token, body: { side: 'buy', asset: 'BTC', asset_amount: '100000' } });
    expect(r.json.quote_amount).toBe('10100');
    await api(ctx, 'POST', '/mock/rates/refresh');
  });

  it('履歴と総資産に反映', async () => {
    const orders = await api(ctx, 'GET', '/me/crypto/orders', { token: user.token });
    expect(orders.json.data.length).toBeGreaterThanOrEqual(4);
    const me = await api(ctx, 'GET', '/me', { token: user.token });
    const btc = me.json.wallets.find((w: { currency: string }) => w.currency === 'BTC');
    // 0.00175 BTC × 15,000,000 = 26,250
    expect(btc.balance).toBe('175000');
    expect(btc.jpy_value).toBe('26250');
    const tx = await api(ctx, 'GET', '/me/transactions?currency=BTC', { token: user.token });
    expect(tx.json.data.map((t: { type: string }) => t.type)).toEqual(expect.arrayContaining(['crypto_buy', 'crypto_sell', 'crypto_deposit']));
  });

  it('台帳整合性: crypto_custody に差額が残る', async () => {
    const v = await ledgerVerify(ctx);
    expect(v.ok).toBe(true);
    const sys = v.system_balances as { system_code: string; currency: string; balance: string }[];
    expect(sys.find((s) => s.system_code === 'crypto_custody' && s.currency === 'JPY')).toBeTruthy();
  });
});
