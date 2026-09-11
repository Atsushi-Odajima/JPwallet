import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestContext, createUser, ledgerVerify, type TestContext } from './helpers';

const CARD_OK = { number: '4242 4242 4242 4242', exp: '12/30', cvc: '123' };
const CARD_NG = { number: '4000000000000002', exp: '12/30', cvc: '123' };

async function jpyBalance(ctx: TestContext, token: string): Promise<string> {
  const r = await api(ctx, 'GET', '/me', { token });
  return r.json.wallets.find((w: { currency: string }) => w.currency === 'JPY').balance;
}

describe('模擬カードチャージ', () => {
  let ctx: TestContext;
  let user: { id: string; token: string };
  beforeAll(async () => {
    ctx = createTestContext();
    user = await createUser(ctx);
  });
  afterAll(() => ctx.close());

  it('テスト成功カードで残高が増え、履歴・通知が作られる', async () => {
    const r = await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '5000', currency: 'JPY', card: CARD_OK } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('succeeded');
    expect(r.json.card_last4).toBe('4242');
    expect(await jpyBalance(ctx, user.token)).toBe('5000');
    const tx = await api(ctx, 'GET', '/me/transactions', { token: user.token });
    expect(tx.json.data[0].type).toBe('topup_card');
    const n = await api(ctx, 'GET', '/me/notifications', { token: user.token });
    expect(n.json.unread_count).toBe(1);
    expect(n.json.data[0].type).toBe('topup_card');
  });

  it('テスト失敗カードは 402 で残高は変わらず、失敗履歴が残る', async () => {
    const r = await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '1000', card: CARD_NG } });
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe('card_declined');
    expect(await jpyBalance(ctx, user.token)).toBe('5000');
    const list = await api(ctx, 'GET', '/me/topups', { token: user.token });
    expect(list.json.data[0].status).toBe('failed');
    expect(list.json.data[0].failure_reason).toBe('card_declined');
  });

  it('テスト番号以外は 400', async () => {
    const r = await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '1000', card: { ...CARD_OK, number: '4111111111111111' } } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('invalid_test_card');
  });

  it('入力検証（金額・有効期限・cvc）', async () => {
    expect((await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '50', card: CARD_OK } })).json.error.code).toBe('amount_too_small');
    expect((await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '1.5', card: CARD_OK } })).status).toBe(400);
    expect((await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '1000', card: { ...CARD_OK, exp: '01/20' } } })).json.error.code).toBe('card_expired');
    expect((await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '1000', card: { ...CARD_OK, cvc: '12' } } })).status).toBe(400);
  });

  it('Idempotency-Key 付きは二重チャージしない', async () => {
    const key = `k-${crypto.randomUUID()}`;
    const a = await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '300', card: CARD_OK }, headers: { 'Idempotency-Key': key } });
    const b = await api(ctx, 'POST', '/me/topups/card', { token: user.token, body: { amount: '300', card: CARD_OK }, headers: { 'Idempotency-Key': key } });
    expect(a.json.id).toBe(b.json.id);
    expect(await jpyBalance(ctx, user.token)).toBe('5300');
  });
});

describe('模擬銀行振込（入金通知フロー）', () => {
  let ctx: TestContext;
  let user: { id: string; token: string };
  let accountNumber: string;
  beforeAll(async () => {
    ctx = createTestContext();
    user = await createUser(ctx, 'bank-user@example.com');
  });
  afterAll(() => ctx.close());

  it('振込先は 1 ユーザーに 1 つ発行され、再発行しても同じ', async () => {
    const a = await api(ctx, 'POST', '/me/topups/bank/virtual-account', { token: user.token });
    expect(a.status).toBe(201);
    expect(a.json.account_number).toMatch(/^\d{7}$/);
    expect(a.json.bank_name).toBeTruthy();
    const b = await api(ctx, 'GET', '/me/topups/bank/virtual-account', { token: user.token });
    expect(b.json.id).toBe(a.json.id);
    accountNumber = a.json.account_number;
  });

  it('入金通知 → 照合 → 仕訳 → 残高反映 → ユーザー通知', async () => {
    const r = await api(ctx, 'POST', '/mock/bank/deposit', {
      body: { account_number: accountNumber, amount: '30000', payer_name: 'ヤマダ タロウ', external_ref: 'BANK-REF-001' },
    });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('processed');
    expect(r.json.topup.method).toBe('bank_transfer');
    expect(r.json.topup.status).toBe('succeeded');
    expect(r.json.notification.status).toBe('processed');
    expect(await jpyBalance(ctx, user.token)).toBe('30000');

    const n = await api(ctx, 'GET', '/me/notifications', { token: user.token });
    expect(n.json.data[0].type).toBe('topup_bank');
    expect(n.json.data[0].title).toBe('入金を確認しました');

    const deps = await api(ctx, 'GET', '/me/topups/bank/deposits', { token: user.token });
    expect(deps.json.data).toHaveLength(1);
    expect(deps.json.data[0].payer_name).toBe('ヤマダ タロウ');
  });

  it('同じ参照番号の通知は二重反映しない（冪等）', async () => {
    const r = await api(ctx, 'POST', '/mock/bank/deposit', {
      body: { account_number: accountNumber, amount: '30000', payer_name: 'ヤマダ タロウ', external_ref: 'BANK-REF-001' },
    });
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('duplicate');
    expect(await jpyBalance(ctx, user.token)).toBe('30000');
  });

  it('存在しない口座への入金は未照合として記録され 404', async () => {
    const r = await api(ctx, 'POST', '/mock/bank/deposit', { body: { account_number: '0000000', amount: '1000', payer_name: 'ダレカ' } });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('virtual_account_not_found');
    expect(r.json.notification.status).toBe('unmatched');
  });

  it('virtual_account_id 指定でも入金できる', async () => {
    const va = await api(ctx, 'GET', '/me/topups/bank/virtual-account', { token: user.token });
    const r = await api(ctx, 'POST', '/mock/bank/deposit', { body: { virtual_account_id: va.json.id, amount: '500' } });
    expect(r.status).toBe(201);
    expect(await jpyBalance(ctx, user.token)).toBe('30500');
  });

  it('モック無効時は 404', async () => {
    const off = createTestContext({}, { mockEndpoints: false });
    const r = await api(off, 'POST', '/mock/bank/deposit', { body: { account_number: accountNumber, amount: '1' } });
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe('mock_disabled');
    await off.close();
  });

  it('台帳整合性', async () => {
    const v = await ledgerVerify(ctx);
    expect(v.ok).toBe(true);
    const bank = (v.system_balances as { system_code: string; currency: string; balance: string }[]).find((s) => s.system_code === 'bank_clearing');
    expect(bank?.balance).toBe('-30500');
  });
});
