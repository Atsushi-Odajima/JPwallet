import type { ApiErrorBody, ApiErrorType } from '@payccount/shared';

/** API が返す業務エラー。HTTP ステータスと Stripe 風のエラー本文を持つ */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: ApiErrorType,
    public readonly code: string,
    message: string,
    public readonly param?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        type: this.type,
        code: this.code,
        message: this.message,
        ...(this.param ? { param: this.param } : {}),
      },
    };
  }

  static badRequest(code: string, message: string, param?: string) {
    return new ApiError(400, 'invalid_request_error', code, message, param);
  }
  static unauthorized(code = 'unauthorized', message = '認証が必要です') {
    return new ApiError(401, 'authentication_error', code, message);
  }
  static forbidden(code = 'forbidden', message = 'この操作を行う権限がありません') {
    return new ApiError(403, 'permission_error', code, message);
  }
  static notFound(code = 'not_found', message = 'リソースが見つかりません') {
    return new ApiError(404, 'not_found', code, message);
  }
  static conflict(code: string, message: string, param?: string) {
    return new ApiError(409, 'idempotency_error', code, message, param);
  }
  static gone(code: string, message: string) {
    return new ApiError(410, 'invalid_request_error', code, message);
  }
  static rateLimited(message = 'リクエストが多すぎます。しばらく待ってから再試行してください') {
    return new ApiError(429, 'rate_limited', 'rate_limited', message);
  }
  static internal(message = 'サーバー内部エラーが発生しました') {
    return new ApiError(500, 'api_error', 'internal_error', message);
  }
}

/** DB（RPC）が raise した業務エラー。message にコード、detail に人間向けメッセージ */
export class DbError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
    public readonly param?: string,
    public readonly sqlState?: string,
  ) {
    super(detail || code);
    this.name = 'DbError';
  }
}

/**
 * RPC のエラーコード → HTTP へのマッピング。
 * ここに無いコードは 400 invalid_request_error として返す。
 */
const DB_CODE_MAP: Record<string, { status: number; type: ApiErrorType }> = {
  insufficient_funds: { status: 402, type: 'insufficient_funds' },
  not_found: { status: 404, type: 'not_found' },
  session_not_found: { status: 404, type: 'not_found' },
  payment_not_found: { status: 404, type: 'not_found' },
  refund_not_found: { status: 404, type: 'not_found' },
  merchant_not_found: { status: 404, type: 'not_found' },
  quote_not_found: { status: 404, type: 'not_found' },
  endpoint_not_found: { status: 404, type: 'not_found' },
  event_not_found: { status: 404, type: 'not_found' },
  account_not_found: { status: 404, type: 'not_found' },
  virtual_account_not_found: { status: 404, type: 'not_found' },
  api_key_not_found: { status: 404, type: 'not_found' },
  campaign_not_found: { status: 404, type: 'not_found' },
  quote_expired: { status: 410, type: 'invalid_request_error' },
  session_expired: { status: 410, type: 'invalid_request_error' },
  invalid_credentials: { status: 401, type: 'authentication_error' },
  forbidden: { status: 403, type: 'permission_error' },
  idempotency_conflict: { status: 409, type: 'idempotency_error' },
  duplicate: { status: 409, type: 'idempotency_error' },
};

export function dbErrorToApiError(err: DbError): ApiError {
  const mapped = DB_CODE_MAP[err.code];
  if (mapped) {
    return new ApiError(mapped.status, mapped.type, err.code, err.detail || err.code, err.param);
  }
  // 業務エラー（P0001）は 400、それ以外（SQL エラー等）は 500
  if (err.sqlState && err.sqlState !== 'P0001') {
    console.error('database error', err.sqlState, err.code, err.detail);
    return ApiError.internal('データベースエラーが発生しました');
  }
  return new ApiError(400, 'invalid_request_error', err.code, err.detail || err.code, err.param);
}
