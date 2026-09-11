import type { AppConfig } from '../env';
import { PgDb } from './pg';
import type { Db } from './port';
import { SupabaseDb } from './supabase';

export type { Db, RpcParams } from './port';
export { PgDb } from './pg';
export { SupabaseDb } from './supabase';

/** 環境変数から DB アダプタを選ぶ（Supabase 優先、なければローカル Postgres） */
export function createDbFromConfig(config: AppConfig): Db {
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    return new SupabaseDb(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  if (config.databaseUrl) {
    return new PgDb(config.databaseUrl, { max: 2 });
  }
  throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY または DATABASE_URL を設定してください');
}
