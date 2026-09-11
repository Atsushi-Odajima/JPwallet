import { OrderStore, json, type Env } from '../../_lib/store';

/** GET /api/orders — 注文一覧（新しい順） */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const store = new OrderStore(env.ORDERS);
  const orders = await store.list(50);
  return json({ data: orders });
};
