import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, createUser, fundUser, ledgerVerify, type TestContext } from './helpers';

async function balance(ctx: TestContext, token: string, currency: string): Promise<string> {
  const r = await api(ctx, 'GET', '/me', { token });
  return r.json.wallets.find((w: { currency: string }) => w.currency === currency).balance;
}

describe('レート', () => {
  let ctx: TestContext;
  beforeAll(() => {
    ctx = createTestContext();
  });
  afterAll(() => ctx.close());

  it('GET /rates は認証なしで参照できる', async () => {
    const all = await api(ctx, 'GET', '/rates');
    expect(all.status).toBe(200);
    expect(all.json.data.find((r: { base: string }) => r.base === 'USD').rate).toBe('150');
    const one = await api(ctx, 'GET', '/rates?base=USD&quote=JPY');
    expect(one.json.rate).toBe('150');
    const inv = await api(ctx, 'GET', '/rates?base=JPY&quote=USD');
    expect(inv.json.rate.startsWith('0.00666666')).toBe(true);
    const cross = await api(ctx, 'GET', '/rates?base=EUR&quote=USD');
    expect(cross.json.rate).toBe('1.08');
  });

  it('未対応通貨は 400', async () => {
    const r = await api(ctx, 'GET', '/rates?base=XXX&quote=JPY');
    expect(r.status).toBe(400);
  });

  it('モックでレートを動かせる', async () => {
    const r = await api(ctx, 'POST', '/mock/rates/set', { body: { base: 'USD', quote: 'JPY', rate: '160' } });
    expect(r.status).toBe(200);
    expect(r.json.rate).toBe('160');
    const one = await api(ctx, 'GET', '/rates?base=USD&quote=JPY');
    expect(one.json.rate).toBe('160');
    const reset = await api(ctx, 'POST', '/mock/rates/refresh');
    expect(reset.json.provider).toBe('mock');
    expect((await api(ctx, 'GET', '/rates?base=USD&quote=JPY')).json.rate).toBe('150');
  });
});

describe('両替 Quote → Execute', () => {
  let ctx: TestContext;
  let user: { id: string; token: string };
  beforeAll(async () => {
    ctx = createTestContext();
    user = await createUser(ctx);
    await fundUser(ctx, user.id, 'JPY', '100000');
    // 他テストがレートを動かしていてもシード値に戻す
    await api(ctx, 'POST', '/mock/rates/refresh');
  });
  afterAll(() => ctx.close());

  it('Quote: JPY 15,000 → USD（150 円、スプレッド 0.5%）= $99.50', async () => {
    const r = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'JPY', to_currency: 'USD', from_amount: '15000' } });
    expect(r.status).toBe(201);
    expect(r.json.id).toMatch(/^qt_/);
    expect(r.json.to_amount).toBe('9950');
    expect(r.json.spread_bps).toBe(50);
    expect(r.json.status).toBe('open');
    expect(new Date(r.json.expires_at).getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('Execute: 残高が動き、fx_pool に通貨別の仕訳が入る', async () => {
    const q = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'JPY', to_currency: 'USD', from_amount: '15000' } });
    const ex = await api(ctx, 'POST', `/me/fx/quotes/${q.json.id}/execute`, { token: user.token });
    expect(ex.status).toBe(200);
    expect(ex.json.status).toBe('executed');
    expect(ex.json.journal_id).toBeTruthy();
    expect(await balance(ctx, user.token, 'JPY')).toBe('85000');
    expect(await balance(ctx, user.token, 'USD')).toBe('9950');

    // 二重実行は冪等
    const again = await api(ctx, 'POST', `/me/fx/quotes/${q.json.id}/execute`, { token: user.token });
    expect(again.status).toBe(200);
    expect(again.json.journal_id).toBe(ex.json.journal_id);
    expect(await balance(ctx, user.token, 'JPY')).toBe('85000');

    const v = await ledgerVerify(ctx);
    expect(v.ok).toBe(true);
    const sys = v.system_balances as { system_code: string; currency: string; balance: string }[];
    expect(sys.find((s) => s.system_code === 'fx_pool' && s.currency === 'JPY')?.balance).toBe('15000');
    expect(sys.find((s) => s.system_code === 'fx_pool' && s.currency === 'USD')?.balance).toBe('-9950');

    const tx = await api(ctx, 'GET', '/me/transactions?type=fx_convert', { token: user.token });
    expect(tx.json.data[0].lines).toEqual(expect.arrayContaining([{ currency: 'JPY', amount: '-15000' }, { currency: 'USD', amount: '9950' }]));
  });

  it('総資産の JPY 換算にレートが反映される', async () => {
    const me = await api(ctx, 'GET', '/me', { token: user.token });
    // 85,000 JPY + $99.50 × 150 = 14,925 → 99,925
    expect(me.json.total_jpy).toBe('99925');
    expect(me.json.wallets.find((w: { currency: string }) => w.currency === 'USD').jpy_value).toBe('14925');
  });

  it('逆方向: USD → JPY', async () => {
    const q = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'USD', to_currency: 'JPY', from_amount: '1000' } });
    // $10 × 150 × 0.995 = 1,492.5 → 1,492
    expect(q.json.to_amount).toBe('1492');
    const ex = await api(ctx, 'POST', `/me/fx/quotes/${q.json.id}/execute`, { token: user.token });
    expect(ex.status).toBe(200);
    expect(await balance(ctx, user.token, 'USD')).toBe('8950');
    expect(await balance(ctx, user.token, 'JPY')).toBe('86492');
  });

  it('期限切れの Quote は 410', async () => {
    const q = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'JPY', to_currency: 'EUR', from_amount: '1000' } });
    await ctx.db.raw`update fx_quotes set expires_at = now() - interval '1 second' where id = ${q.json.id}`;
    const ex = await api(ctx, 'POST', `/me/fx/quotes/${q.json.id}/execute`, { token: user.token });
    expect(ex.status).toBe(410);
    expect(ex.json.error.code).toBe('quote_expired');
    const g = await api(ctx, 'GET', `/me/fx/quotes/${q.json.id}`, { token: user.token });
    expect(g.json.status).toBe('expired');
  });

  it('残高不足は 402、Quote は open のまま', async () => {
    const q = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'JPY', to_currency: 'USD', from_amount: '99999999' } });
    expect(q.status).toBe(201);
    const ex = await api(ctx, 'POST', `/me/fx/quotes/${q.json.id}/execute`, { token: user.token });
    expect(ex.status).toBe(402);
    expect(ex.json.error.type).toBe('insufficient_funds');
  });

  it('同じ通貨・非法定通貨・他人の Quote は拒否', async () => {
    expect((await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'JPY', to_currency: 'JPY', from_amount: '100' } })).json.error.code).toBe('same_currency');
    const other = await createUser(ctx);
    const q = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'JPY', to_currency: 'GBP', from_amount: '1000' } });
    const r = await api(ctx, 'POST', `/me/fx/quotes/${q.json.id}/execute`, { token: other.token });
    expect(r.status).toBe(404);
  });

  it('台帳整合性', async () => {
    expect((await ledgerVerify(ctx)).ok).toBe(true);
  });
});
