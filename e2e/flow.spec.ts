import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { API, SHOP_GLOBAL, STATE_FILE, WEB, type E2EState } from './global-setup';

/**
 * 受け入れ基準の主要フロー:
 *   チャージ → 両替 → 海外EC（shop-global）で BTC 払い → Webhook で注文が支払済 → 返金 → 決済時レートで BTC が戻る → 台帳整合
 */
const state: E2EState = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const buyerEmail = `e2e-buyer-${Date.now()}@example.com`;

async function balanceOf(request: APIRequestContext, token: string, currency: string): Promise<bigint> {
  const me = await (await request.get(`${API}/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  return BigInt(me.wallets.find((w: { currency: string }) => w.currency === currency).balance);
}

async function loginAsBuyer(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('メールアドレス').fill(buyerEmail);
  await page.getByRole('button', { name: 'ログイン / 新規登録' }).click();
  await page.waitForURL(`${WEB}/`);
}

test.describe.serial('チャージ → 両替 → 海外ECで BTC 払い → 返金', () => {
  let buyerToken: string;
  let btcBeforePayment: bigint;
  let paymentId: string;

  test('ログインとカードチャージ（¥30,000）', async ({ page, request }) => {
    await loginAsBuyer(page);
    await page.goto(`${WEB}/topup`);
    await page.getByRole('button', { name: '30,000' }).click();
    await page.getByRole('button', { name: 'チャージする' }).click();
    await expect(page.getByText('をチャージしました')).toBeVisible();
    await page.goto(`${WEB}/`);
    await expect(page.locator('section p.tabular').first()).toHaveText('¥30,000');

    const login = await (await request.post(`${API}/auth/demo/login`, { data: { email: buyerEmail } })).json();
    buyerToken = login.access_token;
    expect(await balanceOf(request, buyerToken, 'JPY')).toBe(30000n);
  });

  test('両替（JPY 3,000 → USD、スプレッド 0.5%）', async ({ page, request }) => {
    await loginAsBuyer(page);
    await page.goto(`${WEB}/exchange`);
    await page.getByLabel('両替する金額').fill('3000');
    await page.getByRole('button', { name: '見積もりを取得' }).click();
    await expect(page.getByText('適用レート')).toBeVisible();
    await page.getByRole('button', { name: '両替を実行' }).click();
    await expect(page.getByText('両替が完了しました')).toBeVisible();
    expect(await balanceOf(request, buyerToken, 'USD')).toBe(1990n); // $19.90
    expect(await balanceOf(request, buyerToken, 'JPY')).toBe(27000n);
  });

  test('BTC を購入（¥10,000 分）', async ({ page, request }) => {
    await loginAsBuyer(page);
    await page.goto(`${WEB}/crypto`);
    await expect(page.getByText('BTC を購入')).toBeVisible();
    await page.getByRole('button', { name: '購入する' }).click();
    await expect(page.getByText('購入しました')).toBeVisible();
    btcBeforePayment = await balanceOf(request, buyerToken, 'BTC');
    expect(btcBeforePayment).toBe(66006n); // 10000 / 15,150,000 BTC = 0.00066006
  });

  test('海外EC（USD 精算）で BTC 払い → Webhook で注文が支払済になる', async ({ page, request }) => {
    await loginAsBuyer(page);
    await page.goto(SHOP_GLOBAL);
    await expect(page.getByRole('link', { name: /Globe Goods/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add to cart' }).nth(2).click(); // Wireless Earbuds $49.99
    await page.getByRole('button', { name: 'Pay with payCcount' }).click();
    await page.waitForURL(/\/checkout\/cs_/);
    await expect(page.getByText('$49.99').first()).toBeVisible();
    // BTC の必要額: $49.99 / (100,000 × 0.99) = 0.00050495 BTC
    await page.getByRole('button', { name: /BTC/ }).click();
    await expect(page.getByRole('button', { name: /0\.00050495 を支払う/ })).toBeVisible();
    await page.getByRole('button', { name: /を支払う/ }).click();
    await expect(page.getByText('支払いが完了しました')).toBeVisible();
    await page.waitForURL(/localhost:5175\/thanks\?session_id=cs_/);
    await expect(page.getByText('Paid', { exact: true })).toBeVisible({ timeout: 20_000 });

    expect(await balanceOf(request, buyerToken, 'BTC')).toBe(btcBeforePayment - 50495n);

    // 加盟店残高は USD で増え、fee_revenue と crypto_custody に差額
    const bal = await (await request.get(`${API}/v1/balance`, { headers: { authorization: `Bearer ${state.apiKey}` } })).json();
    expect(bal.available).toEqual([{ currency: 'USD', amount: '4920' }]);
    const payments = await (await request.get(`${API}/v1/payments`, { headers: { authorization: `Bearer ${state.apiKey}` } })).json();
    paymentId = payments.data[0].id;
    expect(payments.data[0].fee_amount).toBe('79');
    expect(payments.data[0].source_currency).toBe('BTC');
  });

  test('返金（$10）→ 決済時レートの按分で BTC が戻り、注文が一部返金になる', async ({ page, request }) => {
    const refund = await (
      await request.post(`${API}/v1/payments/${paymentId}/refunds`, {
        headers: { authorization: `Bearer ${state.apiKey}`, 'Idempotency-Key': `e2e-refund-${Date.now()}` },
        data: { amount: '1000', reason: 'requested_by_customer' },
      })
    ).json();
    expect(refund.source_amount).toBe('10101'); // floor(50495 × 1000 / 4999)
    expect(await balanceOf(request, buyerToken, 'BTC')).toBe(btcBeforePayment - 50495n + 10101n);

    await loginAsBuyer(page);
    await page.goto(`${SHOP_GLOBAL}/orders`);
    await expect(page.getByText('Partially refunded').first()).toBeVisible({ timeout: 20_000 });
  });

  test('台帳整合性（全仕訳合計 0 / 口座 >= 0 / balance と集計一致）', async ({ request }) => {
    const admin = await (await request.post(`${API}/auth/demo/admin-login`, { data: { id: 'kuro', password: 'atusi0130' } })).json();
    const verify = await (await request.get(`${API}/admin/ledger/verify`, { headers: { authorization: `Bearer ${admin.access_token}` } })).json();
    expect(verify.ok).toBe(true);
    const sys = verify.system_balances as { system_code: string; currency: string; balance: string }[];
    expect(sys.find((s) => s.system_code === 'fee_revenue' && s.currency === 'USD')).toBeTruthy();
    expect(sys.find((s) => s.system_code === 'crypto_custody' && s.currency === 'USD')).toBeTruthy();
  });
});
