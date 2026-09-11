import { IDEMPOTENCY_HEADER, sha256Hex } from '@payccount/shared';
import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/errors';
import type { AppEnv } from '../types';

interface StoredResponse {
  request_hash: string;
  status_code: number;
  response_body: unknown;
}

/**
 * 加盟店 API の冪等性ミドルウェア（POST のみ）。
 *   - Idempotency-Key は必須（無ければ 400）
 *   - 同一キー + 同一ボディ → 保存済みレスポンスを再送（Idempotency-Replayed: true）
 *   - 同一キー + 異なるボディ → 409 idempotency_error
 *   - 成功・失敗（5xx 以外）のレスポンスを保存する
 * 加盟店ごとにキー空間を分ける。
 */
export const idempotency: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'POST') {
    await next();
    return;
  }
  const key = c.req.header(IDEMPOTENCY_HEADER);
  if (!key || key.trim().length === 0) {
    throw ApiError.badRequest('idempotency_key_required', `POST リクエストには ${IDEMPOTENCY_HEADER} ヘッダーが必須です`, IDEMPOTENCY_HEADER);
  }
  if (key.length > 255) throw ApiError.badRequest('idempotency_key_too_long', 'Idempotency-Key は 255 文字以内です', IDEMPOTENCY_HEADER);
  const merchantId = c.var.apiKey?.merchantId;
  if (!merchantId) throw ApiError.unauthorized();

  const bodyText = await c.req.raw.clone().text();
  const path = new URL(c.req.url).pathname;
  const requestHash = await sha256Hex(`${c.req.method}\n${path}\n${bodyText}`);
  c.set('idempotencyKey', key);

  const stored = await c.var.db.rpc<StoredResponse | null>('idempotency_lookup', { p_merchant_id: merchantId, p_key: key });
  if (stored) {
    if (stored.request_hash !== requestHash) {
      throw ApiError.conflict('idempotency_key_reused', '同じ Idempotency-Key が異なるリクエスト内容で再利用されました', IDEMPOTENCY_HEADER);
    }
    c.header('Idempotency-Replayed', 'true');
    return c.json(stored.response_body as object, stored.status_code as 200);
  }

  await next();

  const res = c.res;
  if (res && res.status < 500) {
    const text = await res.clone().text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    await c.var.db.rpc('idempotency_store', {
      p_merchant_id: merchantId,
      p_key: key,
      p_request_hash: requestHash,
      p_status_code: res.status,
      p_response_body: json ?? {},
    });
  }
};
