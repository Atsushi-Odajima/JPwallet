import { Hono } from 'hono';
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
