import type { ApiErrorBody } from '@payccount/shared';
import { getLocale, t, type MessageKey } from '../i18n';
import { hasMessage } from '../i18n/messages';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');

/** API のエラー（Stripe 風 error オブジェクト） */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: string,
    public readonly code: string,
    message: string,
    public readonly param?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let tokenProvider: () => Promise<string | null> = async () => null;

/** 認証トークンの取得方法を登録する（AuthProvider が設定） */
export function setTokenProvider(fn: () => Promise<string | null>) {
  tokenProvider = fn;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** 認証ヘッダーを付けない */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (!opts.anonymous) {
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API_URL}${path}`, { method: opts.method ?? 'GET', headers, body, signal: opts.signal });
  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    throw new ApiClientError(
      res.status,
      err?.type ?? 'api_error',
      err?.code ?? `http_${res.status}`,
      err?.message ?? t('common.request_failed', { status: res.status }),
      err?.param,
      res.headers.get('X-Request-Id') ?? undefined,
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => apiFetch<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...opts, method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...opts, method: 'PATCH', body: body ?? {} }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => apiFetch<T>(path, { ...opts, method: 'DELETE' }),
};

/**
 * エラー表示用の文言。日本語はサーバーの message をそのまま、
 * 英語はエラーコードに対応する文言（i18n の error.*）があればそれを使う。
 */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (getLocale() !== 'ja') {
      const key = `error.${e.code}`;
      if (hasMessage(key)) return t(key as MessageKey);
      if (e.code.startsWith('http_')) return t('common.request_failed', { status: e.status });
    }
    return e.message;
  }
  if (e instanceof Error) {
    if (getLocale() !== 'ja' && e.name === 'TypeError') return t('common.network_error');
    return e.message;
  }
  return String(e);
}
