import { PayCcount, PayCcountError } from '@payccount/js';
import { SHOP, findProduct } from '../../shop.config';
import { OrderStore, json, type Env, type Order, type OrderItem } from '../_lib/store';

interface CheckoutBody {
  items: { id: string; qty: number }[];
}

/**
 * POST /api/checkout — カートの内容から注文を作り、payCcount の Checkout Session を作成して URL を返す。
 * 金額はサーバー側のカタログで再計算する（クライアントの価格は信用しない）。
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PAYCCOUNT_SECRET_KEY) {
    return json({ error: { code: 'not_configured', message: 'PAYCCOUNT_SECRET_KEY が設定されていません（README を参照）' } }, 503);
  }
  let body: CheckoutBody;
  try {
    body = (await request.json()) as CheckoutBody;
  } catch {
    return json({ error: { code: 'invalid_json', message: 'JSON が不正です' } }, 400);
  }
  const items: OrderItem[] = [];
  let total = 0n;
  for (const it of body.items ?? []) {
    const p = findProduct(it.id);
    const qty = Math.floor(Number(it.qty));
    if (!p || !Number.isFinite(qty) || qty <= 0 || qty > 99) continue;
    items.push({ id: p.id, name: p.name, price: p.price, qty });
    total += BigInt(p.price) * BigInt(qty);
  }
  if (items.length === 0) return json({ error: { code: 'empty_cart', message: 'カートが空です' } }, 400);

  const orderId = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const shopUrl = (env.SHOP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const store = new OrderStore(env.ORDERS);

  const order: Order = {
    id: orderId,
    items,
    total: total.toString(),
    currency: SHOP.currency,
    session_id: null,
    checkout_url: null,
    payment_id: null,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    webhooks: [],
  };

  const payccount = new PayCcount(env.PAYCCOUNT_SECRET_KEY, { baseUrl: env.PAYCCOUNT_API_URL ?? 'http://localhost:8787' });
  try {
    const session = await payccount.checkout.sessions.create(
      {
        amount: total.toString(),
        currency: SHOP.currency,
        order_id: orderId,
        description: items.map((i) => `${i.name} ×${i.qty}`).join(', ').slice(0, 200),
        success_url: `${shopUrl}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${shopUrl}/?canceled=${orderId}`,
        metadata: { shop: SHOP.id, order_id: orderId },
      },
      { idempotencyKey: orderId },
    );
    order.session_id = session.id;
    order.checkout_url = session.url;
    await store.create(order);
    return json({ order_id: orderId, session_id: session.id, url: session.url });
  } catch (e) {
    if (e instanceof PayCcountError) {
      return json({ error: { code: e.code, message: `payCcount API エラー: ${e.message}`, request_id: e.requestId } }, e.status >= 500 ? 502 : 400);
    }
    return json({ error: { code: 'upstream_error', message: e instanceof Error ? e.message : String(e) } }, 502);
  }
};
