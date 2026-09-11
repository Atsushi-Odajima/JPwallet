import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/errors';
import { verifyAccessToken } from '../lib/jwt';
import type { AppEnv } from '../types';

interface ProfileRow {
  user_id: string;
  role: 'user' | 'admin';
  email: string | null;
}

/** Supabase JWT（またはデモ JWT）を検証し、c.var.user を設定する */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) throw ApiError.unauthorized('missing_token', 'Authorization: Bearer <jwt> が必要です');
  const token = m[1]!.trim();
  if (token.startsWith('sk_')) {
    throw ApiError.unauthorized('wrong_credential_type', 'このエンドポイントは APIキーではなくユーザーの JWT で認証してください');
  }
  let claims;
  try {
    claims = await verifyAccessToken(token, c.var.config);
  } catch (e) {
    throw ApiError.unauthorized('invalid_token', 'トークンが無効または期限切れです');
  }
  // プロフィール（役割）を取得。初回はここで作成される
  const profile = await c.var.db.rpc<ProfileRow>('ensure_profile', {
    p_user_id: claims.sub,
    p_email: claims.email ?? null,
    p_display_name: null,
  });
  c.set('user', { id: claims.sub, email: profile.email ?? claims.email, role: profile.role });
  await next();
};

/** 管理者のみ */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.var.user;
  if (!user) throw ApiError.unauthorized();
  if (user.role !== 'admin') throw ApiError.forbidden('admin_only', '管理者権限が必要です');
  await next();
};
