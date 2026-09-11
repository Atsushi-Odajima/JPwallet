import { SETTLEMENT_CODES, type ApiKey, type Merchant, type PointCampaign } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { minorAmountOrZero, paginationQuery, parseBody, parseQuery } from '../lib/validate';
import { requireAdmin, requireUser } from '../middleware/user-auth';
import { runMaintenance } from '../services/maintenance';
import type { AppEnv } from '../types';

/**
 * C. 管理API（/admin/*）— 管理者ロール（profiles.role = 'admin'）の JWT が必要。
 * 全データの閲覧と、デモ運営のための操作（加盟店作成・キャンペーン作成・保守処理の実行）を提供する。
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('/admin/*', requireUser, requireAdmin);

/** 概要（件数・通貨別残高・システム勘定・台帳検証・直近仕訳） */
adminRoutes.get('/admin/overview', async (c) => {
  return c.json(await c.var.db.rpc('admin_overview'));
});

/** 台帳整合性チェック */
adminRoutes.get('/admin/ledger/verify', async (c) => {
  return c.json(await c.var.db.rpc('ledger_verify'));
});

/** 全口座 */
adminRoutes.get('/admin/accounts', async (c) => {
  return c.json(await c.var.db.rpc('admin_list_accounts'));
});

/** 仕訳ブラウザ */
adminRoutes.get('/admin/journals', async (c) => {
  const q = parseQuery(c, paginationQuery.extend({ type: z.string().min(1).max(40).optional() }));
  return c.json(await c.var.db.rpc('admin_list_journals', { p_limit: q.limit, p_starting_after: q.starting_after ?? null, p_type: q.type ?? null }));
});

/** ユーザー */
adminRoutes.get('/admin/users', async (c) => {
  const q = parseQuery(c, z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), q: z.string().max(100).optional() }));
  return c.json(await c.var.db.rpc('admin_list_users', { p_limit: q.limit, p_search: q.q ?? null }));
});
adminRoutes.get('/admin/users/:id', async (c) => {
  const id = z.string().uuid().parse(c.req.param('id'));
  return c.json(await c.var.db.rpc('admin_get_user', { p_user_id: id }));
});

/** 加盟店: 一覧 / 作成（+ 初回 APIキー発行） */
adminRoutes.get('/admin/merchants', async (c) => {
  return c.json(await c.var.db.rpc('admin_list_merchants', { p_limit: 200 }));
});

adminRoutes.post('/admin/merchants', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      country: z.string().trim().length(2).toUpperCase().default('JP'),
      settlement_currency: z.enum(SETTLEMENT_CODES as [string, ...string[]]).default('JPY'),
      website_url: z.string().url().optional(),
      /** 省略時は管理者自身がオーナーになる */
      owner_user_id: z.string().uuid().optional(),
    }),
  );
  const owner = body.owner_user_id ?? c.var.user!.id;
  const merchant = await c.var.db.rpc<Merchant>('create_merchant', {
    p_owner_user_id: owner,
    p_name: body.name,
    p_country: body.country,
    p_settlement_currency: body.settlement_currency,
    p_website_url: body.website_url ?? null,
  });
  const apiKey = await c.var.db.rpc<ApiKey>('create_api_key', { p_merchant_id: merchant.id, p_user_id: c.var.user!.id });
  return c.json({ merchant, api_key: apiKey }, 201);
});

/** 決済 / Checkout Session（全加盟店） */
adminRoutes.get('/admin/payments', async (c) => {
  const q = parseQuery(c, paginationQuery);
  return c.json(await c.var.db.rpc('admin_list_payments', { p_limit: q.limit, p_starting_after: q.starting_after ?? null }));
});
adminRoutes.get('/admin/checkout-sessions', async (c) => {
  return c.json(await c.var.db.rpc('admin_list_checkout_sessions', { p_limit: 100 }));
});

/** Webhook 配信（全加盟店）と手動配信 */
adminRoutes.get('/admin/webhooks/deliveries', async (c) => {
  const q = parseQuery(c, z.object({ status: z.enum(['pending', 'in_flight', 'delivered', 'failed']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }));
  return c.json(await c.var.db.rpc('admin_list_webhook_deliveries', { p_limit: q.limit, p_status: q.status ?? null }));
});
adminRoutes.post('/admin/maintenance/run', async (c) => {
  const result = await runMaintenance(c.var.db, c.var.config, c.var.fetcher, new Date());
  return c.json(result);
});

/** 監査ログ */
adminRoutes.get('/admin/audit-logs', async (c) => {
  return c.json(await c.var.db.rpc('admin_list_audit_logs', { p_limit: 200 }));
});

/** ポイントキャンペーン */
adminRoutes.get('/admin/point-campaigns', async (c) => {
  const res = await c.var.db.rpc<{ data: PointCampaign[] }>('list_point_campaigns', { p_active_only: false });
  return c.json(res);
});

adminRoutes.post('/admin/point-campaigns', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      /** "0.01" = +1% */
      bonus_rate: z.string().refine((s) => /^\d+(\.\d+)?$/.test(s) && Number(s) >= 0 && Number(s) <= 1, 'bonus_rate は 0〜1 の 10 進文字列で指定してください'),
      min_amount: minorAmountOrZero.default('0'),
      active_from: z.string().datetime({ offset: true }).optional(),
      active_to: z.string().datetime({ offset: true }),
    }),
  );
  const campaign = await c.var.db.rpc<PointCampaign>('create_point_campaign', {
    p_name: body.name,
    p_bonus_rate: body.bonus_rate,
    p_min_amount: body.min_amount,
    p_active_from: body.active_from ?? null,
    p_active_to: body.active_to,
  });
  return c.json(campaign, 201);
});
