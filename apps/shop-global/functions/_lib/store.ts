/**
 * Order and webhook-log storage.
 *   - Cloudflare Pages: KV (binding: ORDERS)
 *   - Without the binding: in-memory (development only, lost on restart)
 *
 * Several webhooks arrive concurrently (payment.succeeded and checkout.session.completed), so the
 * order body, its status and the received-webhook log live under separate keys to avoid lost updates
 * from read-modify-write races.
 */
export interface OrderItem {
  id: string;
  name: string;
  price: string;
  qty: number;
}

export type OrderStatus = 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'expired' | 'canceled';

export interface OrderWebhook {
  event_id: string;
  type: string;
  received_at: string;
  summary: string;
}

export interface Order {
  id: string;
  items: OrderItem[];
  total: string;
  currency: string;
  session_id: string | null;
  checkout_url: string | null;
  payment_id: string | null;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  /** received webhooks, newest first */
  webhooks: OrderWebhook[];
}

export interface Env {
  ORDERS?: KVNamespace;
  PAYCCOUNT_API_URL?: string;
  PAYCCOUNT_SECRET_KEY?: string;
  PAYCCOUNT_WEBHOOK_SECRET?: string;
  SHOP_URL?: string;
}

const memory = new Map<string, string>();
const INDEX_KEY = 'orders:index';

export class OrderStore {
  constructor(private readonly kv?: KVNamespace) {}

  private async getRaw(key: string): Promise<string | null> {
    if (this.kv) return this.kv.get(key);
    return memory.get(key) ?? null;
  }
  private async putRaw(key: string, value: string): Promise<void> {
    if (this.kv) await this.kv.put(key, value);
    else memory.set(key, value);
  }
  private async listKeys(prefix: string): Promise<string[]> {
    if (this.kv) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const res = await this.kv.list({ prefix, cursor });
        keys.push(...res.keys.map((k) => k.name));
        cursor = res.list_complete ? undefined : res.cursor;
      } while (cursor);
      return keys;
    }
    return [...memory.keys()].filter((k) => k.startsWith(prefix));
  }

  /** Compose order body + status + webhook log */
  async get(orderId: string): Promise<Order | null> {
    const raw = await this.getRaw(`order:${orderId}`);
    if (!raw) return null;
    const base = JSON.parse(raw) as Order;
    const statusRaw = await this.getRaw(`order-status:${orderId}`);
    if (statusRaw) {
      const s = JSON.parse(statusRaw) as { status: OrderStatus; payment_id: string | null; updated_at: string };
      base.status = s.status;
      base.payment_id = s.payment_id ?? base.payment_id;
      base.updated_at = s.updated_at;
    }
    const keys = await this.listKeys(`order-webhook:${orderId}:`);
    const hooks = await Promise.all(keys.map(async (k) => JSON.parse((await this.getRaw(k)) ?? 'null') as OrderWebhook | null));
    base.webhooks = hooks.filter((h): h is OrderWebhook => !!h).sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
    return base;
  }

  async getBySession(sessionId: string): Promise<Order | null> {
    const id = await this.getRaw(`session:${sessionId}`);
    return id ? this.get(id) : null;
  }

  /** Create the order (the body is immutable afterwards) */
  async create(order: Order): Promise<void> {
    await this.putRaw(`order:${order.id}`, JSON.stringify({ ...order, webhooks: [] }));
    if (order.session_id) await this.putRaw(`session:${order.session_id}`, order.id);
    const index = await this.index();
    if (!index.includes(order.id)) {
      index.unshift(order.id);
      await this.putRaw(INDEX_KEY, JSON.stringify(index.slice(0, 200)));
    }
  }

  /** Status update (payment / refund / expiry) */
  async setStatus(orderId: string, status: OrderStatus, paymentId?: string | null): Promise<void> {
    const prev = await this.getRaw(`order-status:${orderId}`);
    const prevPayment = prev ? (JSON.parse(prev) as { payment_id: string | null }).payment_id : null;
    await this.putRaw(`order-status:${orderId}`, JSON.stringify({ status, payment_id: paymentId ?? prevPayment, updated_at: new Date().toISOString() }));
  }

  /** Append a webhook log entry (one key per event) */
  async addWebhook(orderId: string, hook: OrderWebhook): Promise<void> {
    await this.putRaw(`order-webhook:${orderId}:${hook.received_at}-${hook.event_id}`, JSON.stringify(hook));
  }

  async index(): Promise<string[]> {
    const raw = await this.getRaw(INDEX_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  async list(limit = 50): Promise<Order[]> {
    const ids = (await this.index()).slice(0, limit);
    const orders = await Promise.all(ids.map((id) => this.get(id)));
    return orders.filter((o): o is Order => !!o);
  }

  /** Seen event ids (dedupe) */
  async seenEvent(eventId: string): Promise<boolean> {
    return (await this.getRaw(`event:${eventId}`)) !== null;
  }
  async markEvent(eventId: string): Promise<void> {
    await this.putRaw(`event:${eventId}`, new Date().toISOString());
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
