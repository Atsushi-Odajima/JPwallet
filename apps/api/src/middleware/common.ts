import { DEMO_MODE_HEADER, REQUEST_ID_HEADER } from '@payccount/shared';
import type { Context, ErrorHandler, MiddlewareHandler, NotFoundHandler } from 'hono';
import { ZodError } from 'zod';
import { ApiError, DbError, dbErrorToApiError } from '../lib/errors';
import type { AppEnv } from '../types';

/** 全レスポンスに X-Demo-Mode / X-Request-Id を付ける */
export const demoHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  const requestId = c.req.header(REQUEST_ID_HEADER) || `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  c.set('requestId', requestId);
  await next();
  c.res.headers.set(DEMO_MODE_HEADER, 'true');
  c.res.headers.set(REQUEST_ID_HEADER, requestId);
};

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DbError) return dbErrorToApiError(err);
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const param = issue?.path?.join('.') || undefined;
    return ApiError.badRequest('invalid_request', issue ? `${param ? param + ': ' : ''}${issue.message}` : 'リクエストが不正です', param);
  }
  if (err instanceof SyntaxError) {
    return ApiError.badRequest('invalid_json', 'JSON の形式が正しくありません');
  }
  // Hono の HTTPException（body parse など）
  if (err && typeof err === 'object' && 'status' in err && typeof (err as { status: unknown }).status === 'number') {
    const status = (err as { status: number }).status;
    const message = (err as { message?: string }).message || 'リクエストエラー';
    if (status >= 400 && status < 500) return new ApiError(status, 'invalid_request_error', 'http_error', message);
  }
  console.error('unhandled error', err);
  return ApiError.internal();
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const apiErr = toApiError(err);
  return respondError(c, apiErr);
};

export const notFoundHandler: NotFoundHandler<AppEnv> = (c) => {
  return respondError(c, ApiError.notFound('route_not_found', `${c.req.method} ${c.req.path} は存在しません`));
};

export function respondError(c: Context<AppEnv>, apiErr: ApiError) {
  return c.json(apiErr.toBody(), apiErr.status as 400);
}
