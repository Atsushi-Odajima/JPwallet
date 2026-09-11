import { WebhookSignatureError, constructEvent } from '@payccount/js/webhooks';
import { OrderStore, json, type Env, type Order } from '../_lib/store';

/** Webhook の data.object（Payment または Checkout Session）から必要な項目だけ安全に読む */
interface EventObject {
  id?: string;
  object?: string;
  order_id?: string | null;
  session_id?: string;
  status?: string;
  source_currency?: string;
  source_amount?: string;
  settlement_currency?: string;
  settlement_amount?: string;
  refunded_amount?: string;
  metadata?: Record<string, unknown>;
  refund?: { amount?: string; currency?: string };
}

/**
 * POST /api/webhook — payCcount からの Webhook を受け取り、注文の状態を更新する。
 *   1. 生の本文で署名検証（必須）
 *   2. イベント ID で重複排除
 *   3. payment.succeeded → 支払済 / payment.refunded → 返金 / checkout.session.expired → 期限切れ
 * 状態と受信ログは別キーに保存するので、複数の Webhook が同時に届いても更新が失われない。
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PAYCCOUNT_WEBHOOK_SECRET) {
    return json({ error: { code: 'not_configured', message: 'PAYCCOUNT_WEBHOOK_SECRET が設定されていません' } }, 503);
  }
  const rawBody = await request.text();
  let event;
  try {
    event = await constructEvent<EventObject>(rawBody, request.headers.get('X-payCcount-Signature'), env.PAYCCOUNT_WEBHOOK_SECRET);
  } catch (e) {
    if (e instanceof WebhookSignatureError) return json({ error: { code: 'invalid_signature', message: e.message } }, 400);
    throw e;
  }

  const store = new OrderStore(env.ORDERS);
  if (await store.seenEvent(event.id)) {
    return json({ received: true, duplicate: true });
  }

  const obj = event.data.object ?? {};
  const orderId = obj.order_id ?? (typeof obj.metadata?.order_id === 'string' ? obj.metadata.order_id : null);
  let order: Order | null = orderId ? await store.get(orderId) : null;
  if (!order && obj.session_id) order = await store.getBySession(obj.session_id);
  if (!order && obj.object === 'checkout.session' && obj.id) order = await store.getBySession(obj.id);

  if (order) {
    let summary: string = event.type;
    switch (event.type) {
      case 'payment.succeeded':
        await store.setStatus(order.id, 'paid', obj.id ?? null);
        summary = `支払済（${obj.source_currency} ${obj.source_amount} → ${obj.settlement_currency} ${obj.settlement_amount}）`;
        break;
      case 'payment.refunded':
        await store.setStatus(order.id, obj.status === 'refunded' ? 'refunded' : 'partially_refunded');
        summary = `返金 ${obj.refund?.amount ?? ''} ${obj.refund?.currency ?? ''}（累計 ${obj.refunded_amount ?? ''}）`;
        break;
      case 'checkout.session.expired':
        if (order.status === 'pending') await store.setStatus(order.id, 'expired');
        summary = 'Checkout の期限切れ';
        break;
      case 'checkout.session.completed':
        summary = 'Checkout 完了';
        break;
      default:
        break;
    }
    await store.addWebhook(order.id, { event_id: event.id, type: event.type, received_at: new Date().toISOString(), summary });
  }
  await store.markEvent(event.id);
  return json({ received: true, order_id: order?.id ?? null });
};
