import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from './db/port';
import { demoHeaders, errorHandler, notFoundHandler } from './middleware/common';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { checkoutRoutes } from './routes/checkout';
import { cryptoRoutes } from './routes/crypto';
import { fxRoutes } from './routes/fx';
import { meRoutes } from './routes/me';
import { merchantRoutes } from './routes/merchants';
import { mockRoutes } from './routes/mock';
import { pointsRoutes } from './routes/points';
import { topupRoutes } from './routes/topups';
import { v1Routes } from './routes/v1';
import type { AppDeps, AppEnv } from './types';

/**
 * Hono アプリを組み立てる。Worker エントリとテストの両方から使う。
 * 依存（DB・設定・fetch・時計）は引数で注入する。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  const fetcher = deps.fetcher ?? fetch;

  app.use('*', async (c, next) => {
    c.set('config', deps.config);
    c.set('fetcher', fetcher);

    // バックグラウンド処理（Webhook 配信・ログ）。Workers では waitUntil、それ以外はレスポンス前に await
    const tasks: Promise<void>[] = [];
    let execCtx: { waitUntil(promise: Promise<unknown>): void } | undefined;
    try {
      execCtx = c.executionCtx;
    } catch {
      execCtx = undefined;
    }
    const runTask = async (task: (db: Db) => Promise<void>) => {
      const bdb: Db = typeof deps.db === 'function' ? deps.db() : deps.db;
      try {
        await task(bdb);
      } catch (e) {
        console.error('background task failed', e);
      } finally {
        if (typeof deps.db === 'function') await bdb.close();
      }
    };
    c.set('background', (task) => {
      const p = runTask(task);
      if (execCtx) execCtx.waitUntil(p);
      else tasks.push(p);
    });
    c.set('flushBackground', () => Promise.all(tasks).then(() => undefined));

    if (typeof deps.db === 'function') {
      // リクエストごとに接続を作り、レスポンス後に閉じる
      const db = deps.db();
      c.set('db', db);
      try {
        await next();
      } finally {
        if (!execCtx) await Promise.all(tasks);
        if (execCtx) execCtx.waitUntil(db.close());
        else await db.close();
      }
    } else {
      c.set('db', deps.db);
      try {
        await next();
      } finally {
        if (!execCtx) await Promise.all(tasks);
      }
    }
  });
  app.use('*', demoHeaders);
  app.use(
    '*',
    cors({
      origin: (origin) => {
        const allowed = deps.config.allowedOrigins;
        if (allowed.includes('*')) return origin || '*';
        if (allowed.includes(origin)) return origin;
        // 開発の利便性: localhost / 127.0.0.1 は同一視して許可する
        try {
          const host = new URL(origin).hostname;
          if (host === 'localhost' || host === '127.0.0.1') return origin;
        } catch {
          /* 不正な origin */
        }
        return undefined;
      },
      allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposeHeaders: ['X-Demo-Mode', 'X-Request-Id', 'Idempotency-Replayed', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.get('/', (c) =>
    c.json({
      name: 'payCcount API',
      demo: true,
      message: 'これはデモアプリケーションです。実際の資金は扱いません。',
      docs: `${deps.config.appUrl}/merchant/docs`,
    }),
  );
  app.get('/health', async (c) => {
    return c.json({ ok: true, demo: true, auth_mode: deps.config.authMode, time: new Date().toISOString() });
  });

  if (deps.config.authMode === 'demo') {
    app.route('/', authRoutes);
  } else {
    app.get('/auth/mode', (c) => c.json({ mode: 'supabase', demo: true }));
  }

  app.route('/', meRoutes);
  app.route('/', topupRoutes);
  app.route('/', fxRoutes);
  app.route('/', cryptoRoutes);
  app.route('/', pointsRoutes);
  app.route('/', checkoutRoutes);
  app.route('/', merchantRoutes);
  app.route('/', v1Routes);
  app.route('/', mockRoutes);
  app.route('/', adminRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
