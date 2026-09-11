import { createApp, type App } from './app';
import { PgDb, SupabaseDb, type Db } from './db';
import { configFromEnv, type AppConfig, type Bindings } from './env';

/**
 * Cloudflare Workers エントリ。
 *   - Supabase: HTTP なので 1 つの DB クライアントを全リクエストで共有
 *   - postgres.js: Workers は TCP ソケットをリクエスト間で共有できないため、リクエストごとに接続を作る
 */
let cached: { app: App; config: AppConfig; makeDb: () => Db; shared: boolean } | undefined;

function getApp(env: Bindings) {
  if (!cached) {
    const config = configFromEnv(env);
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      const db = new SupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey);
      cached = { app: createApp({ db, config }), config, makeDb: () => db, shared: true };
    } else if (config.databaseUrl) {
      const url = config.databaseUrl;
      const makeDb = () => new PgDb(url, { max: 1 });
      cached = { app: createApp({ db: makeDb, config }), config, makeDb, shared: false };
    } else {
      throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY または DATABASE_URL を設定してください');
    }
  }
  return cached;
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const { app } = getApp(env);
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    // Webhook 再送・レート取得は Phase 5 / Phase 3 で実装する
    const { makeDb, shared } = getApp(env);
    const db = makeDb();
    try {
      // no-op
    } finally {
      if (!shared) await db.close();
    }
  },
};
