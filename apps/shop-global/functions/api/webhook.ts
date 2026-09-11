import { WebhookSignatureError, constructEvent } from '@payccount/js/webhooks';
import { OrderStore, json, type Env, type Order } from '../_lib/store';

/** Read only the fields we need from data.object (Payment or Checkout Session) */
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
 * POST /api/webhook — receive payCcount webhooks and update the order.
 *   1. verify the signature against the raw body (required)
 *   2. dedupe by event id
 *   3. payment.succeeded → paid / payment.refunded → refunded / checkout.session.expired → expired
 * Status and the webhook log are stored under separate keys so concurrent webhooks never lose updates.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PAYCCOUNT_WEBHOOK_SECRET) {
    return json({ error: { code: 'not_configured', message: 'PAYCCOUNT_WEBHOOK_SECRET is not set' } }, 503);
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
        summary = `Paid (${obj.source_currency} ${obj.source_amount} → ${obj.settlement_currency} ${obj.settlement_amount})`;
        break;
      case 'payment.refunded':
        await store.setStatus(order.id, obj.status === 'refunded' ? 'refunded' : 'partially_refunded');
        summary = `Refund ${obj.refund?.amount ?? ''} ${obj.refund?.currency ?? ''} (total refunded ${obj.refunded_amount ?? ''})`;
        break;
      case 'checkout.session.expired':
        if (order.status === 'pending') await store.setStatus(order.id, 'expired');
        summary = 'Checkout expired';
        break;
      case 'checkout.session.completed':
        summary = 'Checkout completed';
        break;
      default:
        break;
    }
    await store.addWebhook(order.id, { event_id: event.id, type: event.type, received_at: new Date().toISOString(), summary });
  }
  await store.markEvent(event.id);
  return json({ received: true, order_id: order?.id ?? null });
};
