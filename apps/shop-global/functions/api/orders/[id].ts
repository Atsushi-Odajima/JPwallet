import { OrderStore, json, type Env } from '../../_lib/store';

/** GET /api/orders/:id — 注文 ID または Checkout Session ID（cs_…）で 1 件取得 */
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = String(params.id ?? '');
  const store = new OrderStore(env.ORDERS);
  const order = id.startsWith('cs_') ? await store.getBySession(id) : await store.get(id);
  if (!order) return json({ error: { code: 'not_found', message: 'Order not found' } }, 404);
  return json(order);
};
