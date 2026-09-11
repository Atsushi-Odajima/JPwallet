import { SETTLEMENT_CODES, WEBHOOK_EVENT_TYPES, type ApiKey, type Merchant, type Page, type Payment, type Refund, type WebhookEndpoint, type WebhookEvent } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { minorAmount, paginationQuery, parseBody, parseQuery } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import { deliverDueWebhooks } from '../services/webhooks';
import type { AppEnv } from '../types';

/**
 * 加盟店ダッシュボード用 API（/me/merchants/*）— ログインユーザーの JWT で認証し、
 * オーナー（または管理者）だけが操作できる。公開 API（/v1）と同じ RPC を使う。
 */
export const merchantRoutes = new Hono<AppEnv>();

merchantRoutes.use('/me/merchants', requireUser);
merchantRoutes.use('/me/merchants/*', requireUser);

const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), 'http(s):// の URL を指定してください').max(2048);

merchantRoutes.get('/me/merchants', async (c) => {
  const res = await c.var.db.rpc<{ data: Merchant[] }>('list_my_merchants', { p_user_id: c.var.user!.id });
  return c.json(res);
});

merchantRoutes.post('/me/merchants', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      country: z.string().trim().length(2).toUpperCase().default('JP'),
      settlement_currency: z.enum(SETTLEMENT_CODES as [string, ...string[]]).default('JPY'),
      website_url: httpUrl.optional().or(z.literal('')),
    }),
  );
  const merchant = await c.var.db.rpc<Merchant>('create_merchant', {
    p_owner_user_id: c.var.user!.id,
    p_name: body.name,
    p_country: body.country,
    p_settlement_currency: body.settlement_currency,
    p_website_url: body.website_url || null,
  });
  return c.json(merchant, 201);
});

merchantRoutes.get('/me/merchants/:id', async (c) => {
  const merchant = await c.var.db.rpc<Merchant>('get_merchant', { p_merchant_id: c.req.param('id'), p_user_id: c.var.user!.id });
  return c.json(merchant);
});

merchantRoutes.patch('/me/merchants/:id', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(1).max(80).optional(),
      country: z.string().trim().length(2).toUpperCase().optional(),
      settlement_currency: z.enum(SETTLEMENT_CODES as [string, ...string[]]).optional(),
      website_url: httpUrl.or(z.literal('')).optional(),
    }),
  );
  const merchant = await c.var.db.rpc<Merchant>('update_merchant', {
    p_merchant_id: c.req.param('id'),
    p_user_id: c.var.user!.id,
    p_name: body.name ?? null,
    p_country: body.country ?? null,
    p_settlement_currency: body.settlement_currency ?? null,
    p_website_url: body.website_url ?? null,
  });
  return c.json(merchant);
});

merchantRoutes.get('/me/merchants/:id/dashboard', async (c) => {
  const res = await c.var.db.rpc('get_merchant_dashboard', { p_merchant_id: c.req.param('id'), p_user_id: c.var.user!.id });
  return c.json(res);
});

// ───────────────────────── APIキー ─────────────────────────
merchantRoutes.get('/me/merchants/:id/api-keys', async (c) => {
  const res = await c.var.db.rpc<{ data: ApiKey[] }>('list_api_keys', { p_merchant_id: c.req.param('id'), p_user_id: c.var.user!.id });
  return c.json(res);
});
merchantRoutes.post('/me/merchants/:id/api-keys', async (c) => {
  const key = await c.var.db.rpc<ApiKey>('create_api_key', { p_merchant_id: c.req.param('id'), p_user_id: c.var.user!.id });
  return c.json(key, 201);
});
merchantRoutes.delete('/me/merchants/:id/api-keys/:keyId', async (c) => {
  const key = await c.var.db.rpc<ApiKey>('revoke_api_key', { p_merchant_id: c.req.param('id'), p_user_id: c.var.user!.id, p_key_id: c.req.param('keyId') });
  return c.json(key);
});

// ───────────────────────── 決済・返金・残高 ─────────────────────────
async function assertOwner(c: { var: AppEnv['Variables'] }, merchantId: string) {
  await c.var.db.rpc('get_merchant', { p_merchant_id: merchantId, p_user_id: c.var.user!.id });
}

merchantRoutes.get('/me/merchants/:id/payments', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const q = parseQuery(c, paginationQuery.extend({ status: z.enum(['succeeded', 'refunded', 'partially_refunded']).optional() }));
  const page = await c.var.db.rpc<Page<Payment>>('list_payments', {
    p_merchant_id: c.req.param('id'),
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
    p_status: q.status ?? null,
  });
  return c.json(page);
});

merchantRoutes.get('/me/merchants/:id/payments/:pid', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const payment = await c.var.db.rpc<Payment>('get_payment', { p_payment_id: c.req.param('pid'), p_merchant_id: c.req.param('id') });
  return c.json(payment);
});

merchantRoutes.post('/me/merchants/:id/payments/:pid/refunds', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const body = await parseBody(c, z.object({ amount: minorAmount.optional(), reason: z.string().trim().max(200).optional() }));
  const refund = await c.var.db.rpc<Refund>('refund_payment', {
    p_payment_id: c.req.param('pid'),
    p_merchant_id: c.req.param('id'),
    p_amount: body.amount ?? null,
    p_reason: body.reason ?? null,
    p_idempotency_key: c.req.header('Idempotency-Key') ? `dash:${c.req.header('Idempotency-Key')}` : null,
  });
  c.var.background((db) => deliverDueWebhooks(db, c.var.fetcher).then(() => undefined));
  return c.json(refund, 201);
});

merchantRoutes.get('/me/merchants/:id/balance', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const balance = await c.var.db.rpc('get_merchant_balance', { p_merchant_id: c.req.param('id') });
  return c.json(balance);
});

merchantRoutes.get('/me/merchants/:id/balance/transactions', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const q = parseQuery(c, paginationQuery);
  const page = await c.var.db.rpc('list_merchant_balance_transactions', {
    p_merchant_id: c.req.param('id'),
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
  });
  return c.json(page);
});

// ───────────────────────── Webhook ─────────────────────────
merchantRoutes.get('/me/merchants/:id/webhook-endpoints', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const res = await c.var.db.rpc<Page<WebhookEndpoint>>('list_webhook_endpoints', { p_merchant_id: c.req.param('id') });
  return c.json(res);
});

merchantRoutes.post('/me/merchants/:id/webhook-endpoints', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const body = await parseBody(
    c,
    z.object({ url: httpUrl, events: z.array(z.enum(['*', ...WEBHOOK_EVENT_TYPES] as [string, ...string[]])).min(1).optional() }),
  );
  const ep = await c.var.db.rpc<WebhookEndpoint>('create_webhook_endpoint', { p_merchant_id: c.req.param('id'), p_url: body.url, p_events: body.events ?? null });
  return c.json(ep, 201);
});

merchantRoutes.delete('/me/merchants/:id/webhook-endpoints/:eid', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const res = await c.var.db.rpc('delete_webhook_endpoint', { p_merchant_id: c.req.param('id'), p_endpoint_id: c.req.param('eid') });
  return c.json(res);
});

merchantRoutes.get('/me/merchants/:id/events', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const q = parseQuery(c, paginationQuery.extend({ type: z.string().min(1).max(60).optional() }));
  const page = await c.var.db.rpc<Page<WebhookEvent>>('list_webhook_events', {
    p_merchant_id: c.req.param('id'),
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
    p_type: q.type ?? null,
  });
  return c.json(page);
});

merchantRoutes.post('/me/merchants/:id/events/:eid/resend', async (c) => {
  await assertOwner(c, c.req.param('id'));
  const ev = await c.var.db.rpc<WebhookEvent>('resend_webhook_event', { p_merchant_id: c.req.param('id'), p_event_id: c.req.param('eid') });
  c.var.background((db) => deliverDueWebhooks(db, c.var.fetcher).then(() => undefined));
  return c.json(ev);
});

/** 配信をいま実行する（ダッシュボードの「今すぐ配信」） */
merchantRoutes.post('/me/merchants/:id/webhooks/deliver-now', async (c) => {
  await assertOwner(c, c.req.param('id'));
  await c.var.db.rpc('requeue_stale_webhook_deliveries');
  const result = await deliverDueWebhooks(c.var.db, c.var.fetcher);
  return c.json(result);
});

merchantRoutes.get('/me/merchants/:id/request-logs', async (c) => {
  const res = await c.var.db.rpc('list_api_request_logs', { p_merchant_id: c.req.param('id'), p_user_id: c.var.user!.id, p_limit: 50 });
  return c.json(res);
});
