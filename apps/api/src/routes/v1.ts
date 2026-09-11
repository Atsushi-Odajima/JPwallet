import { PAYMENT_SOURCE_CODES, WEBHOOK_EVENT_TYPES, type Balance, type BalanceTransaction, type CheckoutSession, type Page, type Payment, type Refund, type WebhookEndpoint, type WebhookEvent } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { minorAmount, paginationQuery, parseBody, parseQuery } from '../lib/validate';
import { requireApiKey } from '../middleware/api-key-auth';
import { idempotency } from '../middleware/idempotency';
import { deliverDueWebhooks } from '../services/webhooks';
import type { AppEnv } from '../types';

/** B. 加盟店向け公開API（Stripe 風） /v1/* — APIキー認証 + POST は冪等キー必須 */
export const v1Routes = new Hono<AppEnv>();

v1Routes.use('/v1/*', requireApiKey, idempotency);

const httpUrl = z.string().url().refine((u) => /^https?:\/\//.test(u), 'http(s):// の URL を指定してください').max(2048);

// ───────────────────────── Checkout Sessions ─────────────────────────
v1Routes.post('/v1/checkout/sessions', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      amount: minorAmount,
      currency: z.string().trim().toUpperCase(),
      order_id: z.string().trim().max(120).optional(),
      description: z.string().trim().max(500).optional(),
      success_url: httpUrl,
      cancel_url: httpUrl,
      accepted_sources: z.array(z.enum(PAYMENT_SOURCE_CODES as [string, ...string[]])).min(1).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  );
  const session = await c.var.db.rpc<CheckoutSession>('create_checkout_session', {
    p_merchant_id: c.var.apiKey!.merchantId,
    p_amount: body.amount,
    p_currency: body.currency,
    p_order_id: body.order_id ?? null,
    p_description: body.description ?? null,
    p_success_url: body.success_url,
    p_cancel_url: body.cancel_url,
    p_accepted_sources: body.accepted_sources ?? null,
    p_metadata: body.metadata ?? {},
    p_idempotency_key: c.var.idempotencyKey ?? null,
    p_app_url: c.var.config.appUrl,
  });
  return c.json(session, 201);
});

v1Routes.get('/v1/checkout/sessions/:id', async (c) => {
  const session = await c.var.db.rpc<CheckoutSession>('get_checkout_session', {
    p_session_id: c.req.param('id'),
    p_merchant_id: c.var.apiKey!.merchantId,
    p_app_url: c.var.config.appUrl,
  });
  return c.json(session);
});

v1Routes.post('/v1/checkout/sessions/:id/expire', async (c) => {
  const session = await c.var.db.rpc<CheckoutSession>('expire_checkout_session', {
    p_session_id: c.req.param('id'),
    p_merchant_id: c.var.apiKey!.merchantId,
    p_app_url: c.var.config.appUrl,
  });
  c.var.background((db) => deliverDueWebhooks(db, c.var.fetcher).then(() => undefined));
  return c.json(session);
});

// ───────────────────────── Payments / Refunds ─────────────────────────
v1Routes.get('/v1/payments', async (c) => {
  const q = parseQuery(c, paginationQuery.extend({ status: z.enum(['succeeded', 'refunded', 'partially_refunded']).optional() }));
  const page = await c.var.db.rpc<Page<Payment>>('list_payments', {
    p_merchant_id: c.var.apiKey!.merchantId,
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
    p_status: q.status ?? null,
  });
  return c.json(page);
});

v1Routes.get('/v1/payments/:id', async (c) => {
  const payment = await c.var.db.rpc<Payment>('get_payment', { p_payment_id: c.req.param('id'), p_merchant_id: c.var.apiKey!.merchantId });
  return c.json(payment);
});

v1Routes.post('/v1/payments/:id/refunds', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      amount: minorAmount.optional(),
      reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent', 'other']).or(z.string().trim().max(200)).optional(),
    }),
  );
  const refund = await c.var.db.rpc<Refund>('refund_payment', {
    p_payment_id: c.req.param('id'),
    p_merchant_id: c.var.apiKey!.merchantId,
    p_amount: body.amount ?? null,
    p_reason: body.reason ?? null,
    p_idempotency_key: c.var.idempotencyKey ?? null,
  });
  c.var.background((db) => deliverDueWebhooks(db, c.var.fetcher).then(() => undefined));
  return c.json(refund, 201);
});

v1Routes.get('/v1/refunds/:id', async (c) => {
  const refund = await c.var.db.rpc<Refund>('get_refund', { p_refund_id: c.req.param('id'), p_merchant_id: c.var.apiKey!.merchantId });
  return c.json(refund);
});

// ───────────────────────── Balance ─────────────────────────
v1Routes.get('/v1/balance', async (c) => {
  const balance = await c.var.db.rpc<Balance>('get_merchant_balance', { p_merchant_id: c.var.apiKey!.merchantId });
  return c.json(balance);
});

v1Routes.get('/v1/balance/transactions', async (c) => {
  const q = parseQuery(c, paginationQuery);
  const page = await c.var.db.rpc<Page<BalanceTransaction>>('list_merchant_balance_transactions', {
    p_merchant_id: c.var.apiKey!.merchantId,
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
  });
  return c.json(page);
});

// ───────────────────────── Webhooks ─────────────────────────
v1Routes.get('/v1/webhook_endpoints', async (c) => {
  const res = await c.var.db.rpc<Page<WebhookEndpoint>>('list_webhook_endpoints', { p_merchant_id: c.var.apiKey!.merchantId });
  return c.json(res);
});

v1Routes.post('/v1/webhook_endpoints', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      url: httpUrl,
      events: z.array(z.enum(['*', ...WEBHOOK_EVENT_TYPES] as [string, ...string[]])).min(1).optional(),
    }),
  );
  const ep = await c.var.db.rpc<WebhookEndpoint>('create_webhook_endpoint', {
    p_merchant_id: c.var.apiKey!.merchantId,
    p_url: body.url,
    p_events: body.events ?? null,
  });
  return c.json(ep, 201);
});

v1Routes.delete('/v1/webhook_endpoints/:id', async (c) => {
  const res = await c.var.db.rpc('delete_webhook_endpoint', { p_merchant_id: c.var.apiKey!.merchantId, p_endpoint_id: c.req.param('id') });
  return c.json(res);
});

v1Routes.get('/v1/events', async (c) => {
  const q = parseQuery(c, paginationQuery.extend({ type: z.string().min(1).max(60).optional() }));
  const page = await c.var.db.rpc<Page<WebhookEvent>>('list_webhook_events', {
    p_merchant_id: c.var.apiKey!.merchantId,
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
    p_type: q.type ?? null,
  });
  return c.json(page);
});

v1Routes.get('/v1/events/:id', async (c) => {
  const ev = await c.var.db.rpc<WebhookEvent>('get_webhook_event', { p_merchant_id: c.var.apiKey!.merchantId, p_event_id: c.req.param('id') });
  return c.json(ev);
});

v1Routes.post('/v1/events/:id/resend', async (c) => {
  const ev = await c.var.db.rpc<WebhookEvent>('resend_webhook_event', { p_merchant_id: c.var.apiKey!.merchantId, p_event_id: c.req.param('id') });
  c.var.background((db) => deliverDueWebhooks(db, c.var.fetcher).then(() => undefined));
  return c.json(ev);
});
