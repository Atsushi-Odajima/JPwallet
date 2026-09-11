import type { Db } from './db/port';
import type { AppConfig } from './env';

export interface AuthUser {
  id: string;
  email?: string;
  role: 'user' | 'admin';
}

export interface ApiKeyContext {
  apiKeyId: string;
  merchantId: string;
  merchant: {
    id: string;
    name: string;
    settlement_currency: string;
    country: string;
    fee_bps: number;
  };
}

/** Hono のコンテキスト型 */
export type AppEnv = {
  Variables: {
    db: Db;
    config: AppConfig;
    requestId: string;
    user?: AuthUser;
    apiKey?: ApiKeyContext;
    /** 加盟店 API で使う冪等キー */
    idempotencyKey?: string;
  };
};

/** アプリ生成時に注入する依存 */
export interface AppDeps {
  /**
   * DB。インスタンスを渡すと全リクエストで共有する（Supabase/HTTP 向け）。
   * 関数を渡すとリクエストごとに生成し、終了時に close する
   * （Workers では TCP ソケットをリクエスト間で共有できないため postgres.js はこちら）。
   */
  db: Db | (() => Db);
  config: AppConfig;
  /** Webhook 配信・外部レート取得に使う fetch（テストで差し替え可） */
  fetcher?: typeof fetch;
  /** 現在時刻（テストで差し替え可） */
  now?: () => Date;
}
