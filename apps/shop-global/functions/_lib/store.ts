/**
 * 注文と Webhook 受信ログの保存。
 *   - Cloudflare Pages では KV（binding: ORDERS）
 *   - バインディングが無い場合はメモリ（開発用。プロセスが終わると消える）
 */
export interface OrderItem {
  id: string;
  name: string;
  price: string;
  qty: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  total: string;
  currency: string;
  session_id: string | null;
  checkout_url: string | null;
  payment_id: string | null;
  status: 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'expired' | 'canceled';
  created_at: string;
  updated_at: string;
  /** 受信した Webhook（新しい順） */
  webhooks: { event_id: string; type: string; received_at: string; summary: string }[];
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

  async get(orderId: string): Promise<Order | null> {
    const raw = await this.getRaw(`order:${orderId}`);
    return raw ? (JSON.parse(raw) as Order) : null;
  }

  async getBySession(sessionId: string): Promise<Order | null> {
    const id = await this.getRaw(`session:${sessionId}`);
    return id ? this.get(id) : null;
  }

  async put(order: Order): Promise<void> {
    order.updated_at = new Date().toISOString();
    await this.putRaw(`order:${order.id}`, JSON.stringify(order));
    if (order.session_id) await this.putRaw(`session:${order.session_id}`, order.id);
    const index = await this.index();
    if (!index.includes(order.id)) {
      index.unshift(order.id);
      await this.putRaw(INDEX_KEY, JSON.stringify(index.slice(0, 200)));
    }
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

  /** 受信済みイベント ID（重複排除） */
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
