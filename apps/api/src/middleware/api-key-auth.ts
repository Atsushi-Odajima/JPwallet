import { sha256Hex } from '@payccount/shared';
import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/errors';
import type { ApiKeyContext, AppEnv } from '../types';

const RATE_LIMIT_PER_MINUTE = 60;

interface AuthResult {
  api_key_id: string;
  merchant: ApiKeyContext['merchant'];
}

/**
 * B. 加盟店向け公開API の認証: Authorization: Bearer sk_test_xxx
 * - 平文キーの SHA-256 で api_keys を照合（DB には平文を置かない）
 * - APIキーごとに 60 req/分（固定ウィンドウ、DB カウンタ）
 * - リクエストログを非同期で保存
 */
export const requireApiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  const auth = c.req.header('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) throw ApiError.unauthorized('missing_api_key', 'Authorization: Bearer sk_test_... が必要です');
  const key = m[1]!.trim();
  if (!key.startsWith('sk_')) {
    throw ApiError.unauthorized('invalid_api_key', 'APIキーの形式が正しくありません（sk_test_ で始まる必要があります）');
  }
  const hash = await sha256Hex(key);
  let auth_result: AuthResult;
  try {
    auth_result = await c.var.db.rpc<AuthResult>('authenticate_api_key', { p_key_hash: hash });
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'invalid_api_key') {
      throw ApiError.unauthorized('invalid_api_key', 'APIキーが無効です');
    }
    throw e;
  }
  const ctx: ApiKeyContext = { apiKeyId: auth_result.api_key_id, merchantId: auth_result.merchant.id, merchant: auth_result.merchant };
  c.set('apiKey', ctx);

  // レート制限
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const count = await c.var.db.rpc<number>('bump_rate_limit', { p_api_key_id: ctx.apiKeyId, p_window_start: windowStart });
  c.header('X-RateLimit-Limit', String(RATE_LIMIT_PER_MINUTE));
  c.header('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_PER_MINUTE - count)));
  if (count > RATE_LIMIT_PER_MINUTE) {
    c.header('Retry-After', String(60 - (Math.floor(Date.now() / 1000) % 60)));
    throw ApiError.rateLimited();
  }

  try {
    await next();
  } finally {
    const status = c.res?.status ?? 500;
    const duration = Date.now() - started;
    const path = new URL(c.req.url).pathname;
    c.var.background((db) =>
      db
        .rpc('log_api_request', {
          p_merchant_id: ctx.merchantId,
          p_api_key_id: ctx.apiKeyId,
          p_method: c.req.method,
          p_path: path,
          p_status_code: status,
          p_duration_ms: duration,
          p_request_id: c.var.requestId,
        })
        .then(() => undefined),
    );
  }
};
