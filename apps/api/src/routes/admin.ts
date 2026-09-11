import { SETTLEMENT_CODES, type ApiKey, type Merchant, type PointCampaign } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { minorAmountOrZero, parseBody } from '../lib/validate';
import { requireAdmin, requireUser } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/**
 * C. 管理API（/admin/*）— 管理者ロール（profiles.role = 'admin'）の JWT が必要。
 * 全データの閲覧と、デモ運営のための操作（加盟店作成・キャンペーン作成など）を提供する。
 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('/admin/*', requireUser, requireAdmin);

/** 台帳整合性チェック */
adminRoutes.get('/admin/ledger/verify', async (c) => {
  const result = await c.var.db.rpc('ledger_verify');
  return c.json(result);
});

/** 加盟店: 一覧 / 作成（+ 初回 APIキー発行） */
adminRoutes.get('/admin/merchants', async (c) => {
  const res = await c.var.db.rpc('admin_list_merchants', { p_limit: 200 });
  return c.json(res);
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
