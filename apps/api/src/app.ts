import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { demoHeaders, errorHandler, notFoundHandler } from './middleware/common';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { cryptoRoutes } from './routes/crypto';
import { fxRoutes } from './routes/fx';
import { meRoutes } from './routes/me';
import { mockRoutes } from './routes/mock';
import { pointsRoutes } from './routes/points';
import { topupRoutes } from './routes/topups';
import type { AppDeps, AppEnv } from './types';

/**
 * Hono アプリを組み立てる。Worker エントリとテストの両方から使う。
 * 依存（DB・設定・fetch・時計）は引数で注入する。
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('config', deps.config);
    if (typeof deps.db === 'function') {
      // リクエストごとに接続を作り、レスポンス後に閉じる
      const db = deps.db();
      c.set('db', db);
      try {
        await next();
      } finally {
        try {
          c.executionCtx.waitUntil(db.close());
        } catch {
          await db.close();
        }
      }
    } else {
      c.set('db', deps.db);
      await next();
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
      exposeHeaders: ['X-Demo-Mode', 'X-Request-Id', 'Idempotency-Replayed'],
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
  app.route('/', mockRoutes);
  app.route('/', adminRoutes);

  return app;
}

export type App = ReturnType<typeof createApp>;
