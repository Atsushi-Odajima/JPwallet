import { PAYMENT_SOURCE_CODES, type CheckoutSession, type CheckoutView, type Payment } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseBody } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import { deliverDueWebhooks } from '../services/webhooks';
import type { AppEnv } from '../types';

/** ユーザー側の Checkout ページ用 API（JWT） */
export const checkoutRoutes = new Hono<AppEnv>();

checkoutRoutes.use('/me/checkout/*', requireUser);

/** GET /me/checkout/sessions/:id — 加盟店名・金額・支払可能ソースと換算額 */
checkoutRoutes.get('/me/checkout/sessions/:id', async (c) => {
  const view = await c.var.db.rpc<CheckoutView>('get_checkout_view', {
    p_session_id: c.req.param('id'),
    p_user_id: c.var.user!.id,
    p_app_url: c.var.config.appUrl,
  });
  return c.json(view);
});

/** POST /me/checkout/sessions/:id/confirm { source_currency } — 決済実行 */
checkoutRoutes.post('/me/checkout/sessions/:id/confirm', async (c) => {
  const body = await parseBody(c, z.object({ source_currency: z.enum(PAYMENT_SOURCE_CODES as [string, ...string[]]) }));
  const result = await c.var.db.rpc<Payment & { session: CheckoutSession; already_completed?: boolean }>('execute_payment', {
    p_session_id: c.req.param('id'),
    p_user_id: c.var.user!.id,
    p_source_currency: body.source_currency,
    p_app_url: c.var.config.appUrl,
  });
  // Webhook はレスポンス後に非同期配信（失敗は Cron が再送）
  c.var.background((db) => deliverDueWebhooks(db, c.var.fetcher).then(() => undefined));
  const redirectUrl = result.session.success_url.replace('{CHECKOUT_SESSION_ID}', result.session.id);
  return c.json({ payment: result, session: result.session, redirect_url: redirectUrl }, result.already_completed ? 200 : 201);
});

/** POST /me/checkout/sessions/:id/cancel */
checkoutRoutes.post('/me/checkout/sessions/:id/cancel', async (c) => {
  const session = await c.var.db.rpc<CheckoutSession>('cancel_checkout_session_by_user', {
    p_session_id: c.req.param('id'),
    p_user_id: c.var.user!.id,
    p_app_url: c.var.config.appUrl,
  });
  return c.json({ session, redirect_url: session.cancel_url });
});
