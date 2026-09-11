import { signWebhookPayload } from '@payccount/shared';
import { describe, expect, it } from 'vitest';
import { PayCcount, PayCcountError } from './index';

/** 偽の API サーバー（fetch を差し替える） */
function fakeApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    if (headers.authorization !== 'Bearer sk_test_ok') {
      return Response.json({ error: { type: 'authentication_error', code: 'invalid_api_key', message: 'APIキーが無効です' } }, { status: 401, headers: { 'X-Request-Id': 'req_1' } });
    }
    if (url.endsWith('/v1/checkout/sessions') && init?.method === 'POST') {
      return Response.json({ id: 'cs_123', object: 'checkout.session', status: 'open', url: 'http://localhost:5173/checkout/cs_123', ...body }, { status: 201 });
    }
    if (url.includes('/v1/payments?')) return Response.json({ data: [{ id: 'pay_1' }], has_more: false });
    if (url.endsWith('/refunds')) return Response.json({ id: 're_1', object: 'refund', amount: body.amount }, { status: 201 });
    if (url.endsWith('/v1/balance')) return Response.json({ object: 'balance', available: [{ currency: 'JPY', amount: '100' }], pending: [] });
    return Response.json({ error: { type: 'not_found', code: 'route_not_found', message: 'nope' } }, { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe('PayCcount SDK', () => {
  it('Checkout Session を作成し、Idempotency-Key と Authorization を付ける', async () => {
    const { calls, fetcher } = fakeApi();
    const client = new PayCcount('sk_test_ok', { baseUrl: 'https://api.test/', fetch: fetcher });
    const session = await client.checkout.sessions.create(
      { amount: '5980', currency: 'JPY', order_id: 'ORDER-1', success_url: 'https://s/ok', cancel_url: 'https://s/ng' },
      { idempotencyKey: 'ORDER-1' },
    );
    expect(session.id).toBe('cs_123');
    expect(calls[0]!.url).toBe('https://api.test/v1/checkout/sessions');
    expect(calls[0]!.headers['idempotency-key']).toBe('ORDER-1');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(calls[0]!.body.amount).toBe('5980');
  });

  it('POST で冪等キーを省略すると自動生成される', async () => {
    const { calls, fetcher } = fakeApi();
    const client = new PayCcount('sk_test_ok', { baseUrl: 'https://api.test', fetch: fetcher });
    await client.payments.refund('pay_1', { amount: '100' });
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^sdk_/);
    expect(calls[0]!.url).toBe('https://api.test/v1/payments/pay_1/refunds');
  });

  it('クエリパラメータと GET', async () => {
    const { calls, fetcher } = fakeApi();
    const client = new PayCcount('sk_test_ok', { baseUrl: 'https://api.test', fetch: fetcher });
    const page = await client.payments.list({ limit: 5, status: 'succeeded' });
    expect(page.data[0]!.id).toBe('pay_1');
    expect(calls[0]!.url).toBe('https://api.test/v1/payments?limit=5&status=succeeded');
    expect(calls[0]!.headers['idempotency-key']).toBeUndefined();
    const bal = await client.balance.retrieve();
    expect(bal.available[0]!.amount).toBe('100');
  });

  it('エラーは PayCcountError（status / code / requestId）', async () => {
    const { fetcher } = fakeApi();
    const client = new PayCcount('sk_test_bad', { baseUrl: 'https://api.test', fetch: fetcher });
    await expect(client.balance.retrieve()).rejects.toMatchObject({ status: 401, code: 'invalid_api_key', requestId: 'req_1' });
    try {
      await client.balance.retrieve();
    } catch (e) {
      expect(e).toBeInstanceOf(PayCcountError);
    }
  });

  it('sk_ で始まらないキーは拒否', () => {
    expect(() => new PayCcount('pk_test_x')).toThrow();
  });

  it('webhooks.constructEvent は署名を検証してイベントを返す', async () => {
    const client = new PayCcount('sk_test_ok', { baseUrl: 'https://api.test' });
    const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', created: 1, demo: true, data: { object: { id: 'pay_1' } } });
    const sig = await signWebhookPayload(body, 'whsec_secret');
    const ev = await client.webhooks.constructEvent<{ id: string }>(body, sig, 'whsec_secret');
    expect(ev.type).toBe('payment.succeeded');
    expect(ev.data.object.id).toBe('pay_1');
    await expect(client.webhooks.constructEvent(body, sig, 'whsec_other')).rejects.toThrow('署名が一致しません');
    await expect(client.webhooks.constructEvent(body + ' ', sig, 'whsec_secret')).rejects.toThrow();
    const old = await signWebhookPayload(body, 'whsec_secret', Math.floor(Date.now() / 1000) - 3600);
    await expect(client.webhooks.constructEvent(body, old, 'whsec_secret')).rejects.toThrow('タイムスタンプ');
    await expect(client.webhooks.constructEvent(body, null, 'whsec_secret')).rejects.toThrow('署名ヘッダーがありません');
  });
});
