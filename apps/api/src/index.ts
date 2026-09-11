import { createApp, type App } from './app';
import { PgDb, SupabaseDb, type Db } from './db';
import { configFromEnv, type AppConfig, type Bindings } from './env';
import { runMaintenance } from './services/maintenance';

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

  /** Cron（毎分）: 期限切れ Quote の掃除、live レート取得、Webhook 再送 */
  async scheduled(event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const { makeDb, shared, config } = getApp(env);
    const db = makeDb();
    try {
      const result = await runMaintenance(db, config, fetch, new Date(event.scheduledTime));
      console.log('maintenance', JSON.stringify(result));
    } finally {
      if (!shared) await db.close();
    }
  },
};
