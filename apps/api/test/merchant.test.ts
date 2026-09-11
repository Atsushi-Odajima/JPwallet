import { verifyWebhookSignature } from '@payccount/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, api, createTestContext, createUser, fundUser, ledgerVerify, type TestContext } from './helpers';

/** 偽の Webhook 受信サーバー（fetch を差し替える） */
function fakeWebhookServer() {
  const received: { url: string; body: string; headers: Record<string, string> }[] = [];
  let mode: 'ok' | 'fail' | 'down' = 'ok';
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://shop.test/')) return new Response('not found', { status: 404 });
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    received.push({ url, body: String(init?.body ?? ''), headers });
    if (mode === 'down') throw new TypeError('fetch failed: ECONNREFUSED');
    if (mode === 'fail') return new Response('internal error', { status: 500 });
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  }) as typeof fetch;
  return { received, fetcher, setMode: (m: typeof mode) => (mode = m) };
}

async function balance(ctx: TestContext, token: string, currency: string): Promise<string> {
  const r = await api(ctx, 'GET', '/me', { token });
  return r.json.wallets.find((w: { currency: string }) => w.currency === currency).balance;
}

const v1 = (ctx: TestContext, key: string, method: string, path: string, body?: unknown, idem?: string) =>
  api(ctx, method, path, { token: key, body, headers: idem ? { 'Idempotency-Key': idem } : {} });

describe('加盟店 API + Checkout', () => {
  const hook = fakeWebhookServer();
  let ctx: TestContext;
  let owner: { id: string; token: string };
  let buyer: { id: string; token: string };
  let merchantJp: { id: string };
  let keyJp: string;
  let merchantUs: { id: string };
  let keyUs: string;
  let webhookSecret: string;

  beforeAll(async () => {
    ctx = createTestContext({ fetcher: hook.fetcher });
    owner = await createUser(ctx, 'owner@example.com');
    buyer = await createUser(ctx, 'buyer@example.com');
    await api(ctx, 'POST', '/mock/rates/refresh');
    await fundUser(ctx, buyer.id, 'JPY', '100000');
    await fundUser(ctx, buyer.id, 'USD', '10000');
    await fundUser(ctx, buyer.id, 'BTC', '1000000');
    // PT は購入で付与（3,000 JPY → 3,030 PT）
    await api(ctx, 'POST', '/me/points/purchase', { token: buyer.token, body: { amount_jpy: '3000', method: 'wallet_jpy' } });
  });
  afterAll(() => ctx.close());

  describe('加盟店とAPIキー', () => {
    it('加盟店を作成し APIキーを発行できる（平文は一度だけ）', async () => {
      const m = await api(ctx, 'POST', '/me/merchants', { token: owner.token, body: { name: 'デモ商店', country: 'JP', settlement_currency: 'JPY', website_url: 'https://shop.test' } });
      expect(m.status).toBe(201);
      merchantJp = m.json;
      const k = await api(ctx, 'POST', `/me/merchants/${merchantJp.id}/api-keys`, { token: owner.token });
      expect(k.status).toBe(201);
      expect(k.json.key).toMatch(/^sk_test_[0-9a-f]{48}$/);
      keyJp = k.json.key;
      const list = await api(ctx, 'GET', `/me/merchants/${merchantJp.id}/api-keys`, { token: owner.token });
      expect(list.json.data[0].key).toBeUndefined();
      expect(list.json.data[0].prefix).toMatch(/^sk_test_/);

      const me = await api(ctx, 'GET', '/me', { token: owner.token });
      expect(me.json.merchant_ids).toContain(merchantJp.id);
    });

    it('海外EC（USD 精算）も作成できる', async () => {
      const m = await api(ctx, 'POST', '/me/merchants', { token: owner.token, body: { name: 'Global Shop', country: 'US', settlement_currency: 'USD' } });
      merchantUs = m.json;
      const k = await api(ctx, 'POST', `/me/merchants/${merchantUs.id}/api-keys`, { token: owner.token });
      keyUs = k.json.key;
    });

    it('他人の加盟店は操作できない', async () => {
      const r = await api(ctx, 'POST', `/me/merchants/${merchantJp.id}/api-keys`, { token: buyer.token });
      expect(r.status).toBe(403);
    });

    it('APIキー認証: 無効なキーは 401、JWT を渡すと 401', async () => {
      expect((await v1(ctx, 'sk_test_invalid', 'GET', '/v1/balance')).status).toBe(401);
      expect((await api(ctx, 'GET', '/v1/balance', { token: owner.token })).status).toBe(401);
      expect((await api(ctx, 'GET', '/v1/balance')).status).toBe(401);
    });

    it('失効したキーは使えない', async () => {
      const k = await api(ctx, 'POST', `/me/merchants/${merchantJp.id}/api-keys`, { token: owner.token });
      expect((await v1(ctx, k.json.key, 'GET', '/v1/balance')).status).toBe(200);
      await api(ctx, 'DELETE', `/me/merchants/${merchantJp.id}/api-keys/${k.json.id}`, { token: owner.token });
      expect((await v1(ctx, k.json.key, 'GET', '/v1/balance')).status).toBe(401);
    });

    it('管理者は加盟店を作成できる（初回キー付き）', async () => {
      const r = await api(ctx, 'POST', '/admin/merchants', { token: await adminToken(), body: { name: '管理者作成店', settlement_currency: 'JPY' } });
      expect(r.status).toBe(201);
      expect(r.json.api_key.key).toMatch(/^sk_test_/);
      const list = await api(ctx, 'GET', '/admin/merchants', { token: await adminToken() });
      expect(list.json.data.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Checkout Session', () => {
    const sessionBody = {
      amount: '5980',
      currency: 'JPY',
      order_id: 'ORDER-1001',
      description: '商品A ×1',
      success_url: 'https://shop.test/thanks?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://shop.test/cart',
      metadata: { customer_id: 'c_123' },
    };

    it('POST には Idempotency-Key が必須', async () => {
      const r = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', sessionBody);
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe('idempotency_key_required');
    });

    it('同一キーで 2 回叩いても Session は 1 つ（再送は Idempotency-Replayed）', async () => {
      const a = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', sessionBody, 'ORDER-1001');
      expect(a.status).toBe(201);
      expect(a.json.id).toMatch(/^cs_/);
      expect(a.json.url).toBe(`http://localhost:5173/checkout/${a.json.id}`);
      expect(a.json.status).toBe('open');
      expect(a.json.accepted_sources).toEqual(['JPY', 'PT', 'USD', 'EUR', 'GBP', 'BTC', 'ETH']);
      const b = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', sessionBody, 'ORDER-1001');
      expect(b.status).toBe(201);
      expect(b.json.id).toBe(a.json.id);
      expect(b.headers.get('Idempotency-Replayed')).toBe('true');
    });

    it('同一キー + 異なるボディは 409', async () => {
      const r = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { ...sessionBody, amount: '1' }, 'ORDER-1001');
      expect(r.status).toBe(409);
      expect(r.json.error.type).toBe('idempotency_error');
    });

    it('通貨は加盟店の精算通貨と一致が必要、URL 検証', async () => {
      const r = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { ...sessionBody, currency: 'USD' }, crypto.randomUUID());
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe('currency_not_supported');
      const r2 = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { ...sessionBody, success_url: 'ftp://x' }, crypto.randomUUID());
      expect(r2.status).toBe(400);
    });

    it('取得・期限切れ', async () => {
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', sessionBody, crypto.randomUUID());
      const g = await v1(ctx, keyJp, 'GET', `/v1/checkout/sessions/${s.json.id}`);
      expect(g.json.id).toBe(s.json.id);
      const other = await v1(ctx, keyUs, 'GET', `/v1/checkout/sessions/${s.json.id}`);
      expect(other.status).toBe(404);
      const e = await v1(ctx, keyJp, 'POST', `/v1/checkout/sessions/${s.json.id}/expire`, {}, crypto.randomUUID());
      expect(e.json.status).toBe('expired');
      const again = await v1(ctx, keyJp, 'POST', `/v1/checkout/sessions/${s.json.id}/expire`, {}, crypto.randomUUID());
      expect(again.status).toBe(400);
    });

    it('レート制限: 60 req/分を超えると 429', async () => {
      const k = await api(ctx, 'POST', `/me/merchants/${merchantUs.id}/api-keys`, { token: owner.token });
      let last = 0;
      for (let i = 0; i < 61; i++) {
        last = (await v1(ctx, k.json.key, 'GET', '/v1/balance')).status;
        if (last === 429) break;
      }
      expect(last).toBe(429);
    });
  });

  describe('Webhook エンドポイント', () => {
    it('作成時だけ secret が返る', async () => {
      const r = await v1(ctx, keyJp, 'POST', '/v1/webhook_endpoints', { url: 'https://shop.test/webhook', events: ['payment.succeeded', 'payment.refunded', 'checkout.session.completed'] }, crypto.randomUUID());
      expect(r.status).toBe(201);
      expect(r.json.secret).toMatch(/^whsec_/);
      webhookSecret = r.json.secret;
      const list = await v1(ctx, keyJp, 'GET', '/v1/webhook_endpoints');
      expect(list.json.data[0].secret).toBeUndefined();
      expect(list.json.data[0].url).toBe('https://shop.test/webhook');
    });
  });

  describe('決済（Checkout ページ）', () => {
    let session: { id: string };

    it('Checkout ビュー: ソースごとの必要額と残高', async () => {
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '5980', currency: 'JPY', order_id: 'ORDER-2001', description: '商品B', success_url: 'https://shop.test/thanks?session_id={CHECKOUT_SESSION_ID}', cancel_url: 'https://shop.test/cart' }, crypto.randomUUID());
      session = s.json;
      const v = await api(ctx, 'GET', `/me/checkout/sessions/${session.id}`, { token: buyer.token });
      expect(v.status).toBe(200);
      expect(v.json.merchant.name).toBe('デモ商店');
      const src = Object.fromEntries(v.json.sources.map((x: { currency: string }) => [x.currency, x]));
      expect(src.JPY.amount).toBe('5980');
      expect(src.JPY.sufficient).toBe(true);
      expect(src.PT.amount).toBe('5980');
      expect(src.PT.sufficient).toBe(false); // 3,030 PT しかない
      // USD: 5980 / (150 × 0.995) = 40.06… → $40.07 = 4007 cents
      expect(src.USD.amount).toBe('4007');
      expect(src.USD.spread_bps).toBe(50);
      // BTC: 5980 / (15,000,000 × 0.99) = 0.000402693… → 40270 sat（切り上げ）
      expect(src.BTC.amount).toBe('40270');
      expect(src.BTC.spread_bps).toBe(100);
      expect(v.json.payment).toBeNull();
    });

    it('JPY で支払う: 手数料 1.6% が fee_revenue、加盟店に net、Webhook が届く', async () => {
      hook.received.length = 0;
      const r = await api(ctx, 'POST', `/me/checkout/sessions/${session.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      expect(r.status).toBe(201);
      expect(r.json.payment.id).toMatch(/^pay_/);
      expect(r.json.payment.source_amount).toBe('5980');
      expect(r.json.payment.fee_amount).toBe('95'); // floor(5980 × 0.016) = 95
      expect(r.json.payment.net_amount).toBe('5885');
      expect(r.json.redirect_url).toBe(`https://shop.test/thanks?session_id=${session.id}`);
      expect(await balance(ctx, buyer.token, 'JPY')).toBe('91020'); // 100000 - 3000 - 5980

      const bal = await v1(ctx, keyJp, 'GET', '/v1/balance');
      expect(bal.json.available).toEqual([{ currency: 'JPY', amount: '5885' }]);

      // Webhook: payment.succeeded と checkout.session.completed が配信され、署名が検証できる
      const types = hook.received.map((x) => JSON.parse(x.body).type).sort();
      expect(types).toEqual(['checkout.session.completed', 'payment.succeeded']);
      const ev = hook.received.find((x) => JSON.parse(x.body).type === 'payment.succeeded')!;
      expect(await verifyWebhookSignature(ev.body, ev.headers['x-payccount-signature'], webhookSecret)).toBe(true);
      await expect(verifyWebhookSignature(ev.body, ev.headers['x-payccount-signature'], 'whsec_wrong')).rejects.toThrow();
      const payload = JSON.parse(ev.body);
      expect(payload.demo).toBe(true);
      expect(payload.data.object.id).toBe(r.json.payment.id);
      expect(payload.data.object.order_id).toBe('ORDER-2001');

      const events = await v1(ctx, keyJp, 'GET', '/v1/events');
      expect(events.json.data[0].deliveries[0].status).toBe('delivered');
      expect(events.json.data[0].deliveries[0].last_status_code).toBe(200);
    });

    it('二重 confirm は同じ決済を返す（冪等）', async () => {
      const r = await api(ctx, 'POST', `/me/checkout/sessions/${session.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      expect(r.status).toBe(200);
      expect(r.json.payment.already_completed).toBe(true);
      expect(await balance(ctx, buyer.token, 'JPY')).toBe('91020');
    });

    it('別ユーザーは完了済み Session を決済できない', async () => {
      const r = await api(ctx, 'POST', `/me/checkout/sessions/${session.id}/confirm`, { token: owner.token, body: { source_currency: 'JPY' } });
      expect(r.status).toBe(400);
    });

    it('PT で支払う（加盟店には JPY で精算、points_issuer が JPY を負担）', async () => {
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '1000', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/ng' }, crypto.randomUUID());
      const r = await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'PT' } });
      expect(r.status).toBe(201);
      expect(r.json.payment.source_currency).toBe('PT');
      expect(await balance(ctx, buyer.token, 'PT')).toBe('2030');
      const bal = await v1(ctx, keyJp, 'GET', '/v1/balance');
      expect(bal.json.available[0].amount).toBe('6869'); // 5885 + (1000 - 16)
    });

    it('残高不足のソースは 402、受け付けないソースは 400、期限切れは 410', async () => {
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '999999', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/ng', accepted_sources: ['JPY'] }, crypto.randomUUID());
      expect((await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } })).status).toBe(402);
      expect((await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'USD' } })).json.error.code).toBe('source_not_accepted');
      await ctx.db.raw`update checkout_sessions set expires_at = now() - interval '1 second' where id = ${s.json.id}`;
      const ex = await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      expect(ex.status).toBe(410);
      expect(ex.json.error.code).toBe('session_expired');
      // 期限切れイベントが発行されている
      const events = await v1(ctx, keyJp, 'GET', '/v1/events?type=checkout.session.expired');
      expect(events.json.data.length).toBeGreaterThanOrEqual(1);
    });

    it('ユーザーが Session をキャンセルできる', async () => {
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '100', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/cart' }, crypto.randomUUID());
      const r = await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/cancel`, { token: buyer.token });
      expect(r.json.session.status).toBe('canceled');
      expect(r.json.redirect_url).toBe('https://shop.test/cart');
    });
  });

  describe('海外EC: BTC 払い → USD 精算 → 返金', () => {
    let payment: { id: string; source_amount: string };
    let btcBefore: string;

    it('shop-global で BTC 払い → 加盟店残高が USD で増え、fee_revenue と crypto_custody に差額', async () => {
      btcBefore = await balance(ctx, buyer.token, 'BTC');
      const s = await v1(ctx, keyUs, 'POST', '/v1/checkout/sessions', { amount: '4999', currency: 'USD', order_id: 'G-1', success_url: 'https://global.test/ok', cancel_url: 'https://global.test/ng' }, crypto.randomUUID());
      const view = await api(ctx, 'GET', `/me/checkout/sessions/${s.json.id}`, { token: buyer.token });
      const btc = view.json.sources.find((x: { currency: string }) => x.currency === 'BTC');
      // BTC→USD mid = 15,000,000 / 150 = 100,000 USD/BTC, 実効 99,000。$49.99 / 99,000 = 0.000504949… → 50495 sat
      expect(btc.mid_rate).toBe('100000');
      expect(btc.amount).toBe('50495');

      const r = await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'BTC' } });
      expect(r.status).toBe(201);
      payment = r.json.payment;
      expect(payment.source_amount).toBe('50495');
      expect(r.json.payment.settlement_currency).toBe('USD');
      expect(r.json.payment.fee_amount).toBe('79'); // floor(4999 × 0.016) = 79
      expect(await balance(ctx, buyer.token, 'BTC')).toBe((BigInt(btcBefore) - 50495n).toString());

      const bal = await v1(ctx, keyUs, 'GET', '/v1/balance');
      expect(bal.json.available).toEqual([{ currency: 'USD', amount: '4920' }]);

      const v = await ledgerVerify(ctx);
      expect(v.ok).toBe(true);
      const sys = v.system_balances as { system_code: string; currency: string; balance: string }[];
      expect(sys.find((x) => x.system_code === 'fee_revenue' && x.currency === 'USD')?.balance).toBe('79');
      expect(sys.find((x) => x.system_code === 'crypto_custody' && x.currency === 'USD')?.balance).toBe('-4999');
      expect(BigInt(sys.find((x) => x.system_code === 'crypto_custody' && x.currency === 'BTC')!.balance)).toBeGreaterThan(-1000000n);
    });

    it('部分返金: 加盟店 USD が減り、ユーザーに BTC が決済時レートの按分で戻る', async () => {
      const r = await v1(ctx, keyUs, 'POST', `/v1/payments/${payment.id}/refunds`, { amount: '1000', reason: 'requested_by_customer' }, 'refund-1');
      expect(r.status).toBe(201);
      expect(r.json.id).toMatch(/^re_/);
      expect(r.json.currency).toBe('USD');
      expect(r.json.source_currency).toBe('BTC');
      // floor(50495 × 1000 / 4999) = 10101
      expect(r.json.source_amount).toBe('10101');
      expect(await balance(ctx, buyer.token, 'BTC')).toBe((BigInt(btcBefore) - 50495n + 10101n).toString());
      const p = await v1(ctx, keyUs, 'GET', `/v1/payments/${payment.id}`);
      expect(p.json.status).toBe('partially_refunded');
      expect(p.json.refunded_amount).toBe('1000');
      expect(p.json.refunds).toHaveLength(1);
      // 手数料は返金しない: 加盟店残高 4920 - 1000 = 3920
      const bal = await v1(ctx, keyUs, 'GET', '/v1/balance');
      expect(bal.json.available[0].amount).toBe('3920');
      // 同じ冪等キーは同じ返金
      const again = await v1(ctx, keyUs, 'POST', `/v1/payments/${payment.id}/refunds`, { amount: '1000', reason: 'requested_by_customer' }, 'refund-1');
      expect(again.json.id).toBe(r.json.id);
    });

    it('累計が元金額を超える返金は 400、残り全額返金で BTC が全額戻る', async () => {
      const over = await v1(ctx, keyUs, 'POST', `/v1/payments/${payment.id}/refunds`, { amount: '4000' }, crypto.randomUUID());
      expect(over.status).toBe(400);
      expect(over.json.error.code).toBe('refund_exceeds_payment');
      // 手数料は戻らないので、加盟店残高（3920）だけでは 3999 を返金できない → 402
      const short = await v1(ctx, keyUs, 'POST', `/v1/payments/${payment.id}/refunds`, {}, crypto.randomUUID());
      expect(short.status).toBe(402);
      expect(short.json.error.type).toBe('insufficient_funds');
      // 別の決済で加盟店残高を積んでから全額返金
      const s2 = await v1(ctx, keyUs, 'POST', '/v1/checkout/sessions', { amount: '10000', currency: 'USD', success_url: 'https://global.test/ok', cancel_url: 'https://global.test/ng' }, crypto.randomUUID());
      const pay2 = await api(ctx, 'POST', `/me/checkout/sessions/${s2.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'USD' } });
      expect(pay2.status).toBe(201);
      expect(await balance(ctx, buyer.token, 'USD')).toBe('0');
      const rest = await v1(ctx, keyUs, 'POST', `/v1/payments/${payment.id}/refunds`, {}, crypto.randomUUID());
      expect(rest.status).toBe(201);
      expect(rest.json.amount).toBe('3999');
      expect(rest.json.source_amount).toBe('40394'); // 50495 - 10101
      expect(await balance(ctx, buyer.token, 'BTC')).toBe(btcBefore);
      const p = await v1(ctx, keyUs, 'GET', `/v1/payments/${payment.id}`);
      expect(p.json.status).toBe('refunded');
      // 加盟店は手数料分だけマイナスにならず 0 以上に留まる… 4920 - 4999 は負になるので insufficient_funds になるはず → 実際は手数料込みで残高不足
    });
  });

  describe('返金と加盟店残高', () => {
    it('加盟店残高が不足する返金は 402（手数料分は戻らないため）', async () => {
      // 新しい JPY 加盟店で 1 件だけ決済し、全額返金を試みる → 手数料分だけ足りない
      const m = await api(ctx, 'POST', '/me/merchants', { token: owner.token, body: { name: '残高不足店', settlement_currency: 'JPY' } });
      const k = await api(ctx, 'POST', `/me/merchants/${m.json.id}/api-keys`, { token: owner.token });
      const s = await v1(ctx, k.json.key, 'POST', '/v1/checkout/sessions', { amount: '1000', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/ng' }, crypto.randomUUID());
      await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      const r = await v1(ctx, k.json.key, 'POST', `/v1/payments/${s.json.payment_id ?? (await v1(ctx, k.json.key, 'GET', '/v1/payments')).json.data[0].id}/refunds`, {}, crypto.randomUUID());
      expect(r.status).toBe(402);
      expect(r.json.error.type).toBe('insufficient_funds');
    });
  });

  describe('Webhook の信頼性', () => {
    it('配信先が落ちていると pending のまま再試行がスケジュールされ、復旧後に届く', async () => {
      hook.setMode('down');
      hook.received.length = 0;
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '500', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/ng' }, crypto.randomUUID());
      await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      let events = await v1(ctx, keyJp, 'GET', '/v1/events?type=payment.succeeded&limit=1');
      let d = events.json.data[0].deliveries[0];
      expect(d.status).toBe('pending');
      expect(d.attempts).toBe(1);
      expect(d.last_error).toContain('ECONNREFUSED');
      expect(new Date(d.next_retry_at).getTime()).toBeGreaterThan(Date.now() + 30_000);

      // 復旧。再試行時刻を前倒しして Cron 相当の保守処理を回す
      hook.setMode('ok');
      await ctx.db.raw`update webhook_deliveries set next_retry_at = now() - interval '1 second' where id = ${d.id}`;
      const mt = await api(ctx, 'POST', '/mock/maintenance/run');
      expect(mt.json.webhooks.delivered).toBeGreaterThanOrEqual(1);
      events = await v1(ctx, keyJp, 'GET', '/v1/events?type=payment.succeeded&limit=1');
      d = events.json.data[0].deliveries[0];
      expect(d.status).toBe('delivered');
      expect(d.attempts).toBe(2);
    });

    it('5 回失敗すると failed になり、再送で新しい配信が作られる', async () => {
      hook.setMode('fail');
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '300', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/ng' }, crypto.randomUUID());
      await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      const ev = (await v1(ctx, keyJp, 'GET', '/v1/events?type=payment.succeeded&limit=1')).json.data[0];
      for (let i = 0; i < 4; i++) {
        await ctx.db.raw`update webhook_deliveries set next_retry_at = now() - interval '1 second' where event_id = ${ev.id} and status = 'pending'`;
        await api(ctx, 'POST', '/mock/maintenance/run');
      }
      let e = await v1(ctx, keyJp, 'GET', `/v1/events/${ev.id}`);
      expect(e.json.deliveries[0].status).toBe('failed');
      expect(e.json.deliveries[0].attempts).toBe(5);
      expect(e.json.deliveries[0].last_status_code).toBe(500);

      hook.setMode('ok');
      const rs = await v1(ctx, keyJp, 'POST', `/v1/events/${ev.id}/resend`, {}, crypto.randomUUID());
      expect(rs.json.resent).toBe(1);
      e = await v1(ctx, keyJp, 'GET', `/v1/events/${ev.id}`);
      expect(e.json.deliveries).toHaveLength(2);
      expect(e.json.deliveries[1].status).toBe('delivered');
    });

    it('エンドポイント削除後は配信されない', async () => {
      const list = await v1(ctx, keyJp, 'GET', '/v1/webhook_endpoints');
      const del = await v1(ctx, keyJp, 'DELETE', `/v1/webhook_endpoints/${list.json.data[0].id}`);
      expect(del.json.deleted).toBe(true);
      hook.received.length = 0;
      const s = await v1(ctx, keyJp, 'POST', '/v1/checkout/sessions', { amount: '200', currency: 'JPY', success_url: 'https://shop.test/ok', cancel_url: 'https://shop.test/ng' }, crypto.randomUUID());
      await api(ctx, 'POST', `/me/checkout/sessions/${s.json.id}/confirm`, { token: buyer.token, body: { source_currency: 'JPY' } });
      expect(hook.received).toHaveLength(0);
    });
  });

  describe('加盟店ダッシュボード API と台帳', () => {
    it('ダッシュボード・決済一覧・残高明細・リクエストログ', async () => {
      const d = await api(ctx, 'GET', `/me/merchants/${merchantJp.id}/dashboard`, { token: owner.token });
      expect(d.status).toBe(200);
      expect(Number(d.json.stats.payments_count)).toBeGreaterThanOrEqual(4);
      expect(d.json.recent_payments.length).toBeGreaterThan(0);
      const p = await api(ctx, 'GET', `/me/merchants/${merchantJp.id}/payments?limit=2`, { token: owner.token });
      expect(p.json.data).toHaveLength(2);
      expect(p.json.has_more).toBe(true);
      const bt = await v1(ctx, keyJp, 'GET', '/v1/balance/transactions?limit=3');
      expect(bt.json.data[0].type).toBe('payment');
      expect(bt.json.data[0].currency).toBe('JPY');
      const logs = await api(ctx, 'GET', `/me/merchants/${merchantJp.id}/request-logs`, { token: owner.token });
      expect(logs.json.data.length).toBeGreaterThan(0);
      expect(logs.json.data[0].path).toMatch(/^\/v1\//);
      const pay = await api(ctx, 'GET', '/me/transactions?type=payment', { token: buyer.token });
      expect(pay.json.data[0].metadata.merchant_name).toBeTruthy();
    });

    it('台帳整合性', async () => {
      const v = await ledgerVerify(ctx);
      expect(v.ok).toBe(true);
    });
  });
});
