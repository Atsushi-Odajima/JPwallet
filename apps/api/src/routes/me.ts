import type { Me, Notification, Page, Transaction } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { currencyCode, paginationQuery, parseBody, parseQuery } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/** A. ウォレット内部API（ユーザー）— 基本（プロフィール・残高・履歴・通知） */
export const meRoutes = new Hono<AppEnv>();

meRoutes.use('/me/*', requireUser);
meRoutes.use('/me', requireUser);

meRoutes.get('/me', async (c) => {
  const me = await c.var.db.rpc<Me>('get_me', { p_user_id: c.var.user!.id, p_email: c.var.user!.email ?? null });
  return c.json(me);
});

meRoutes.patch('/me', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      display_name: z.string().trim().min(1).max(50).optional(),
      country: z.string().trim().length(2).toUpperCase().optional(),
    }),
  );
  const profile = await c.var.db.rpc('update_profile', {
    p_user_id: c.var.user!.id,
    p_display_name: body.display_name ?? null,
    p_country: body.country ?? null,
  });
  return c.json(profile);
});

meRoutes.get('/me/wallets', async (c) => {
  const me = await c.var.db.rpc<Me>('get_me', { p_user_id: c.var.user!.id, p_email: c.var.user!.email ?? null });
  return c.json({ data: me.wallets, total_jpy: me.total_jpy });
});

meRoutes.get('/me/transactions', async (c) => {
  const q = parseQuery(
    c,
    paginationQuery.extend({
      currency: currencyCode.optional(),
      type: z.string().min(1).max(40).optional(),
    }),
  );
  const page = await c.var.db.rpc<Page<Transaction>>('list_transactions', {
    p_user_id: c.var.user!.id,
    p_currency: q.currency ?? null,
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
    p_type: q.type ?? null,
  });
  return c.json(page);
});

meRoutes.get('/me/notifications', async (c) => {
  const q = parseQuery(
    c,
    z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      unread_only: z.enum(['true', 'false']).default('false'),
    }),
  );
  const res = await c.var.db.rpc<{ data: Notification[]; unread_count: number }>('list_notifications', {
    p_user_id: c.var.user!.id,
    p_limit: q.limit,
    p_unread_only: q.unread_only === 'true',
  });
  return c.json(res);
});

meRoutes.post('/me/notifications/read', async (c) => {
  const body = await parseBody(c, z.object({ ids: z.array(z.string().uuid()).optional() }));
  const n = await c.var.db.rpc<number>('mark_notifications_read', {
    p_user_id: c.var.user!.id,
    p_ids: body.ids ?? null,
  });
  return c.json({ updated: n });
});
