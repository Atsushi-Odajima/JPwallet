import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import { signDemoToken } from '../lib/jwt';
import { parseBody } from '../lib/validate';
import type { AppEnv } from '../types';

/**
 * デモ認証（AUTH_MODE=demo のときだけマウントされる）
 * Supabase Auth を使わないローカル環境向け。メールアドレスだけでログインできる。
 * 管理者は ID + パスワード（admin_credentials）でログインする。
 */
export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/auth/mode', (c) => {
  return c.json({ mode: c.var.config.authMode, demo: true });
});

authRoutes.post('/auth/demo/login', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      email: z.string().email('メールアドレスの形式が正しくありません'),
      display_name: z.string().trim().min(1).max(50).optional(),
    }),
  );
  const user = await c.var.db.rpc<{ user_id: string; email: string }>('demo_upsert_user', {
    p_email: body.email,
    p_display_name: body.display_name ?? null,
  });
  const secret = c.var.config.jwtSecret;
  if (!secret) throw ApiError.internal('JWT_SECRET が設定されていません');
  const { token, expires_at } = await signDemoToken({ sub: user.user_id, email: user.email }, secret);
  return c.json({ access_token: token, token_type: 'bearer', expires_at, user: { id: user.user_id, email: user.email } });
});

authRoutes.post('/auth/demo/admin-login', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      id: z.string().trim().min(1, 'IDを入力してください'),
      password: z.string().min(1, 'パスワードを入力してください'),
    }),
  );
  const admin = await c.var.db.rpc<{ user_id: string; email: string; role: string }>('admin_login', {
    p_login_id: body.id,
    p_password: body.password,
  });
  const secret = c.var.config.jwtSecret;
  if (!secret) throw ApiError.internal('JWT_SECRET が設定されていません');
  const { token, expires_at } = await signDemoToken({ sub: admin.user_id, email: admin.email }, secret);
  return c.json({
    access_token: token,
    token_type: 'bearer',
    expires_at,
    user: { id: admin.user_id, email: admin.email, role: admin.role },
  });
});
