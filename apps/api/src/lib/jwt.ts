import { SignJWT, createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfig } from '../env';

export interface AuthClaims {
  sub: string;
  email?: string;
  role?: string;
}

const encoder = new TextEncoder();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/**
 * JWT を検証してクレームを返す。トークンのヘッダー（alg）で検証方法を選ぶ。
 *   - HS256 かつ JWT_SECRET あり → 共有シークレット（Supabase の legacy JWT secret / デモ認証）
 *   - それ以外（ES256 / RS256 など）→ Supabase の JWKS（新しいプロジェクトは「JWT Signing Keys」で ES256 を発行する）
 * Supabase では anon / service_role キーが HS256 のままでも、ユーザーのアクセストークンは ES256 になり得るため両対応にしている。
 */
export async function verifyAccessToken(token: string, config: AppConfig): Promise<AuthClaims> {
  let payload: JWTPayload;
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw new Error('JWT のヘッダーを読めません');
  }
  const useSecret = !!config.jwtSecret && (alg === 'HS256' || !config.supabaseUrl);
  if (useSecret) {
    const res = await jwtVerify(token, encoder.encode(config.jwtSecret!), {
      algorithms: ['HS256'],
    });
    payload = res.payload;
  } else if (config.supabaseUrl) {
    const url = `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
    let jwks = jwksCache.get(url);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(url));
      jwksCache.set(url, jwks);
    }
    const res = await jwtVerify(token, jwks);
    payload = res.payload;
  } else {
    throw new Error('JWT_SECRET または SUPABASE_URL が必要です');
  }
  if (!payload.sub) throw new Error('sub がありません');
  return {
    sub: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    role: typeof payload.role === 'string' ? payload.role : undefined,
  };
}

/** デモ認証用のアクセストークンを発行する（HS256） */
export async function signDemoToken(
  claims: { sub: string; email?: string },
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 7,
): Promise<{ token: string; expires_at: string }> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ email: claims.email, role: 'authenticated', aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setIssuer('payccount-demo')
    .setExpirationTime(now + ttlSeconds)
    .sign(encoder.encode(secret));
  return { token, expires_at: new Date((now + ttlSeconds) * 1000).toISOString() };
}
