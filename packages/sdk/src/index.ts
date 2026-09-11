import type {
  ApiErrorBody,
  Balance,
  BalanceTransaction,
  CheckoutSession,
  CurrencyCode,
  Page,
  Payment,
  Refund,
  WebhookEndpoint,
  WebhookEvent,
  WebhookEventType,
} from '@payccount/shared';
import { constructEvent, verifyWebhookSignature } from './webhooks';

export type {
  Balance,
  BalanceTransaction,
  CheckoutSession,
  CurrencyCode,
  Page,
  Payment,
  Refund,
  WebhookEndpoint,
  WebhookEvent,
  WebhookEventType,
} from '@payccount/shared';
export { WebhookSignatureError, constructEvent, verifyWebhookSignature } from './webhooks';

const SDK_VERSION = '0.1.0';
const DEFAULT_BASE_URL = 'http://localhost:8787';

export interface PayCcountOptions {
  /** API のベース URL（例: https://api.payccount.example） */
  baseUrl?: string;
  /** fetch の差し替え（テスト用） */
  fetch?: typeof fetch;
  /** タイムアウト（ms） */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** 冪等キー。POST で省略すると自動生成される */
  idempotencyKey?: string;
}

export interface ListParams {
  limit?: number;
  starting_after?: string;
}

export interface CreateCheckoutSessionParams {
  amount: string;
  currency: string;
  order_id?: string;
  description?: string;
  success_url: string;
  cancel_url: string;
  accepted_sources?: CurrencyCode[];
  metadata?: Record<string, unknown>;
}

export interface CreateRefundParams {
  /** 省略で残り全額 */
  amount?: string;
  reason?: 'requested_by_customer' | 'duplicate' | 'fraudulent' | 'other' | string;
}

export interface CreateWebhookEndpointParams {
  url: string;
  events?: (WebhookEventType | '*')[];
}

/** API エラー（Stripe 風）。status / type / code / param / requestId を持つ */
export class PayCcountError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly code: string,
    message: string,
    public readonly param?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'PayCcountError';
  }
}

/**
 * payCcount 加盟店向け SDK（サーバー側）。
 *
 * ```ts
 * const payccount = new PayCcount('sk_test_...', { baseUrl: process.env.PAYCCOUNT_API_URL });
 * const session = await payccount.checkout.sessions.create({ ... }, { idempotencyKey: 'ORDER-1001' });
 * ```
 */
export class PayCcount {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly secretKey: string,
    options: PayCcountOptions = {},
  ) {
    if (!secretKey || !secretKey.startsWith('sk_')) {
      throw new Error('payCcount: secretKey は sk_test_ で始まる APIキーを指定してください');
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    // Workers では fetch を別の this で呼ぶと "Illegal invocation" になるので、必ずラップして呼ぶ
    const f = options.fetch ?? fetch;
    this.fetcher = (input, init) => f(input, init);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  // ───────────────────────── Checkout ─────────────────────────
  readonly checkout = {
    sessions: {
      create: (params: CreateCheckoutSessionParams, opts?: RequestOptions) =>
        this.request<CheckoutSession>('POST', '/v1/checkout/sessions', params, opts),
      retrieve: (id: string) => this.request<CheckoutSession>('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
      expire: (id: string, opts?: RequestOptions) =>
        this.request<CheckoutSession>('POST', `/v1/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, opts),
    },
  };

  // ───────────────────────── Payments / Refunds ─────────────────────────
  readonly payments = {
    list: (params: ListParams & { status?: Payment['status'] } = {}) => this.request<Page<Payment>>('GET', `/v1/payments${qs(params)}`),
    retrieve: (id: string) => this.request<Payment & { refunds: Refund[] }>('GET', `/v1/payments/${encodeURIComponent(id)}`),
    refund: (id: string, params: CreateRefundParams = {}, opts?: RequestOptions) =>
      this.request<Refund>('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`, params, opts),
  };

  readonly refunds = {
    create: (paymentId: string, params: CreateRefundParams = {}, opts?: RequestOptions) => this.payments.refund(paymentId, params, opts),
    retrieve: (id: string) => this.request<Refund>('GET', `/v1/refunds/${encodeURIComponent(id)}`),
  };

  // ───────────────────────── Balance ─────────────────────────
  readonly balance = {
    retrieve: () => this.request<Balance>('GET', '/v1/balance'),
    transactions: {
      list: (params: ListParams = {}) => this.request<Page<BalanceTransaction>>('GET', `/v1/balance/transactions${qs(params)}`),
    },
  };

  // ───────────────────────── Webhooks ─────────────────────────
  readonly webhookEndpoints = {
    list: () => this.request<Page<WebhookEndpoint>>('GET', '/v1/webhook_endpoints'),
    create: (params: CreateWebhookEndpointParams, opts?: RequestOptions) => this.request<WebhookEndpoint>('POST', '/v1/webhook_endpoints', params, opts),
    del: (id: string) => this.request<{ id: string; deleted: true }>('DELETE', `/v1/webhook_endpoints/${encodeURIComponent(id)}`),
  };

  readonly events = {
    list: (params: ListParams & { type?: WebhookEventType } = {}) => this.request<Page<WebhookEvent>>('GET', `/v1/events${qs(params)}`),
    retrieve: (id: string) => this.request<WebhookEvent>('GET', `/v1/events/${encodeURIComponent(id)}`),
    resend: (id: string, opts?: RequestOptions) => this.request<WebhookEvent>('POST', `/v1/events/${encodeURIComponent(id)}/resend`, {}, opts),
  };

  /** Webhook の署名検証（受信側で使う） */
  readonly webhooks = {
    constructEvent: <T = unknown>(rawBody: string, signatureHeader: string | null | undefined, secret: string, toleranceSec = 300) =>
      constructEvent<T>(rawBody, signatureHeader, secret, toleranceSec),
    verifySignature: (rawBody: string, signatureHeader: string | null | undefined, secret: string, toleranceSec = 300) =>
      verifyWebhookSignature(rawBody, signatureHeader, secret, toleranceSec),
  };

  // ───────────────────────── 内部 ─────────────────────────
  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      Accept: 'application/json',
      'User-Agent': `payccount-js/${SDK_VERSION}`,
    };
    let payload: string | undefined;
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = opts.idempotencyKey ?? generateIdempotencyKey();
      payload = JSON.stringify(body ?? {});
    }
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload,
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined,
    });
    const text = await res.text();
    let json: unknown = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const err = (json as ApiErrorBody | undefined)?.error;
      throw new PayCcountError(
        res.status,
        err?.type ?? 'api_error',
        err?.code ?? `http_${res.status}`,
        err?.message ?? `payCcount API error (${res.status})`,
        err?.param,
        res.headers.get('X-Request-Id') ?? undefined,
      );
    }
    return json as T;
  }
}

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : '';
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `sdk_${crypto.randomUUID()}`;
  return `sdk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
