import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, api, createTestContext, createUser, fundUser, ledgerVerify, type TestContext } from './helpers';

const CARD_OK = { number: '4242424242424242', exp: '12/30', cvc: '123' };
const CARD_NG = { number: '4000000000000002', exp: '12/30', cvc: '123' };

async function balance(ctx: TestContext, token: string, currency: string): Promise<string> {
  const r = await api(ctx, 'GET', '/me', { token });
  return r.json.wallets.find((w: { currency: string }) => w.currency === currency).balance;
}

describe('ポイント', () => {
  let ctx: TestContext;
  let user: { id: string; token: string };
  beforeAll(async () => {
    ctx = createTestContext();
    user = await createUser(ctx);
    await fundUser(ctx, user.id, 'JPY', '50000');
  });
  afterAll(() => ctx.close());

  it('有効なキャンペーン一覧', async () => {
    const r = await api(ctx, 'GET', '/me/points/campaigns', { token: user.token });
    expect(r.status).toBe(200);
    expect(r.json.data.length).toBeGreaterThanOrEqual(2);
    expect(r.json.data[0].bonus_rate).toBe('0.01');
  });

  it('JPY 残高で購入: ¥3,000 → 3,030 PT（+1%）', async () => {
    const r = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '3000', method: 'wallet_jpy' } });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe('succeeded');
    expect(r.json.points_granted).toBe('3030');
    expect(r.json.bonus_points).toBe('30');
    expect(await balance(ctx, user.token, 'PT')).toBe('3030');
    expect(await balance(ctx, user.token, 'JPY')).toBe('47000');
  });

  it('¥10,000 以上は +3% が適用される（最大のボーナス）', async () => {
    const r = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '10000', method: 'card', card: CARD_OK } });
    expect(r.status).toBe(201);
    expect(r.json.points_granted).toBe('10300');
    expect(r.json.card_last4).toBe('4242');
    expect(await balance(ctx, user.token, 'PT')).toBe('13330');
    // カード購入は JPY 残高を使わない
    expect(await balance(ctx, user.token, 'JPY')).toBe('47000');
  });

  it('¥500 はキャンペーン対象外（ボーナス 0）', async () => {
    const r = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '500', method: 'wallet_jpy' } });
    expect(r.json.bonus_points).toBe('0');
    expect(r.json.points_granted).toBe('500');
  });

  it('失敗カードは 402、失敗履歴が残る', async () => {
    const r = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '1000', method: 'card', card: CARD_NG } });
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe('card_declined');
    const list = await api(ctx, 'GET', '/me/points/purchases', { token: user.token });
    expect(list.json.data[0].status).toBe('failed');
  });

  it('JPY 残高不足は 402', async () => {
    const r = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '999999', method: 'wallet_jpy' } });
    expect(r.status).toBe(402);
    expect(r.json.error.type).toBe('insufficient_funds');
  });

  it('Idempotency-Key で二重付与しない', async () => {
    const key = `pt-${crypto.randomUUID()}`;
    const before = await balance(ctx, user.token, 'PT');
    const a = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '1000', method: 'wallet_jpy' }, headers: { 'Idempotency-Key': key } });
    const b = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '1000', method: 'wallet_jpy' }, headers: { 'Idempotency-Key': key } });
    expect(a.json.id).toBe(b.json.id);
    expect(BigInt(await balance(ctx, user.token, 'PT')) - BigInt(before)).toBe(1010n);
  });

  describe('銀行振込での購入（入金通知で完了）', () => {
    let reference: string;
    let accountNumber: string;

    it('pending の購入と振込識別コードが発行される', async () => {
      const r = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '20000', method: 'bank_transfer' } });
      expect(r.status).toBe(201);
      expect(r.json.status).toBe('pending');
      expect(r.json.transfer_reference).toMatch(/^PT[0-9A-F]{8}$/);
      expect(r.json.points_granted).toBe('20600');
      reference = r.json.transfer_reference;
      const va = await api(ctx, 'POST', '/me/topups/bank/virtual-account', { token: user.token });
      accountNumber = va.json.account_number;
    });

    it('識別コード付きの入金で PT が付与される（振込人名から抽出）', async () => {
      const before = await balance(ctx, user.token, 'PT');
      const jpyBefore = await balance(ctx, user.token, 'JPY');
      const r = await api(ctx, 'POST', '/mock/bank/deposit', {
        body: { account_number: accountNumber, amount: '20000', payer_name: `${reference} ヤマダ タロウ`, external_ref: `PTDEP-${reference}` },
      });
      expect(r.status).toBe(201);
      expect(r.json.status).toBe('processed');
      expect(r.json.point_purchase.status).toBe('succeeded');
      expect(r.json.topup).toBeNull();
      expect(BigInt(await balance(ctx, user.token, 'PT')) - BigInt(before)).toBe(20600n);
      // JPY 残高は変わらない（振込は PT に充当）
      expect(await balance(ctx, user.token, 'JPY')).toBe(jpyBefore);
      const n = await api(ctx, 'GET', '/me/notifications', { token: user.token });
      expect(n.json.data[0].title).toContain('ポイントを付与');
    });

    it('同じ入金通知の再送は二重付与しない', async () => {
      const before = await balance(ctx, user.token, 'PT');
      const r = await api(ctx, 'POST', '/mock/bank/deposit', {
        body: { account_number: accountNumber, amount: '20000', payer_name: reference, external_ref: `PTDEP-${reference}` },
      });
      expect(r.json.status).toBe('duplicate');
      expect(await balance(ctx, user.token, 'PT')).toBe(before);
    });

    it('金額が一致しない振込は通常のチャージとして処理される', async () => {
      const p = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '5000', method: 'bank_transfer' } });
      const jpyBefore = await balance(ctx, user.token, 'JPY');
      const r = await api(ctx, 'POST', '/mock/bank/deposit', {
        body: { account_number: accountNumber, amount: '4000', reference: p.json.transfer_reference, payer_name: 'ヤマダ' },
      });
      expect(r.status).toBe(201);
      expect(r.json.topup).not.toBeNull();
      expect(r.json.point_purchase).toBeNull();
      expect(r.json.note).toContain('一致しない');
      expect(BigInt(await balance(ctx, user.token, 'JPY')) - BigInt(jpyBefore)).toBe(4000n);
      const list = await api(ctx, 'GET', '/me/points/purchases', { token: user.token });
      expect(list.json.data.find((x: { id: string }) => x.id === p.json.id).status).toBe('pending');
    });
  });

  it('PT は両替できない', async () => {
    const r = await api(ctx, 'POST', '/me/fx/quotes', { token: user.token, body: { from_currency: 'PT', to_currency: 'JPY', from_amount: '100' } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('unsupported_currency');
  });

  it('管理者はキャンペーンを作成できる（一般ユーザーは 403）', async () => {
    const body = { name: 'テスト +5%', bonus_rate: '0.05', min_amount: '100', active_to: new Date(Date.now() + 86400_000).toISOString() };
    expect((await api(ctx, 'POST', '/admin/point-campaigns', { token: user.token, body })).status).toBe(403);
    const r = await api(ctx, 'POST', '/admin/point-campaigns', { token: await adminToken(), body });
    expect(r.status).toBe(201);
    expect(r.json.bonus_rate).toBe('0.05');
    const buy = await api(ctx, 'POST', '/me/points/purchase', { token: user.token, body: { amount_jpy: '1000', method: 'wallet_jpy' } });
    expect(buy.json.bonus_points).toBe('50');
  });

  it('総資産に PT が 1:1 で含まれ、台帳が整合する', async () => {
    const me = await api(ctx, 'GET', '/me', { token: user.token });
    const pt = me.json.wallets.find((w: { currency: string }) => w.currency === 'PT');
    expect(pt.jpy_value).toBe(pt.balance);
    const v = await ledgerVerify(ctx);
    expect(v.ok).toBe(true);
    const sys = v.system_balances as { system_code: string; currency: string; balance: string }[];
    expect(BigInt(sys.find((s) => s.system_code === 'points_issuer' && s.currency === 'PT')!.balance)).toBeLessThan(0n);
    expect(BigInt(sys.find((s) => s.system_code === 'points_issuer' && s.currency === 'JPY')!.balance)).toBeGreaterThan(0n);
  });
});
