import { createApp } from '../src/app';
import { PgDb } from '../src/db/pg';
import type { AppConfig } from '../src/env';
import { signDemoToken } from '../src/lib/jwt';
import type { AppDeps } from '../src/types';

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-1234';

export function testDatabaseUrl() {
  return (
    process.env.TEST_DATABASE_URL ||
    `postgres://payccount:payccount@127.0.0.1:${process.env.PAYCCOUNT_PGPORT || '54329'}/${process.env.PAYCCOUNT_DB_NAME || 'payccount_test'}`
  );
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    databaseUrl: testDatabaseUrl(),
    authMode: 'demo',
    jwtSecret: TEST_JWT_SECRET,
    appUrl: 'http://localhost:5173',
    allowedOrigins: ['*'],
    mockEndpoints: true,
    ratesProvider: 'mock',
    ...overrides,
  };
}

export interface TestContext {
  db: PgDb;
  app: ReturnType<typeof createApp>;
  config: AppConfig;
  close: () => Promise<void>;
}

export function createTestContext(depsOverride: Partial<AppDeps> = {}, configOverride: Partial<AppConfig> = {}): TestContext {
  const config = testConfig(configOverride);
  const db = new PgDb(config.databaseUrl!, { max: 2 });
  const app = createApp({ db, config, ...depsOverride });
  return { db, app, config, close: () => db.close() };
}

export const ADMIN_USER_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002';

/** 新しいテストユーザーを作成しトークンを返す */
export async function createUser(ctx: TestContext, email = `u${crypto.randomUUID().slice(0, 8)}@example.com`) {
  const u = await ctx.db.rpc<{ user_id: string; email: string }>('demo_upsert_user', { p_email: email, p_display_name: null });
  const { token } = await signDemoToken({ sub: u.user_id, email: u.email }, TEST_JWT_SECRET);
  return { id: u.user_id, email: u.email, token };
}

export async function adminToken() {
  const { token } = await signDemoToken({ sub: ADMIN_USER_ID, email: 'kuro@payccount.demo' }, TEST_JWT_SECRET);
  return token;
}

/** JSON リクエストのヘルパー */
export async function api(
  ctx: TestContext,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await ctx.app.request(path, { method, headers, body });
  const text = await res.text();
  let json: any = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json };
}

/** ユーザーに JPY を付与する（テスト専用。post_journal 経由） */
export async function fundUser(ctx: TestContext, userId: string, currency: string, amount: string) {
  return ctx.db.rpc<string>('post_journal', {
    p_type: 'adjustment',
    p_idempotency_key: null,
    p_lines: [
      { owner_type: 'user', owner_id: userId, currency, amount },
      { system_code: currency === 'BTC' || currency === 'ETH' ? 'crypto_custody' : 'card_clearing', currency, amount: `-${amount}` },
    ],
    p_reference_type: 'test',
    p_reference_id: null,
    p_metadata: { test: true },
  });
}

export async function ledgerVerify(ctx: TestContext) {
  return ctx.db.rpc<{ ok: boolean; [k: string]: unknown }>('ledger_verify');
}
