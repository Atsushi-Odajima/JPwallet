import type { Db } from '../db/port';
import type { AppConfig } from '../env';
import { refreshRates } from './rates';
import { deliverDueWebhooks, type DeliveryRunResult } from './webhooks';

export interface MaintenanceResult {
  expired_fx_quotes: number;
  expired_checkout_sessions: number;
  requeued_stale_deliveries: number;
  webhooks: DeliveryRunResult;
  rates_refreshed: boolean;
  rate_errors: string[];
}

/**
 * Cron（毎分）で実行する保守処理。
 *   - 期限切れ FX Quote / Checkout Session の掃除（Session は checkout.session.expired を発行）
 *   - 取り残された in_flight 配信の再キュー
 *   - 期限が来た Webhook 配信（指数バックオフのリトライ）
 *   - RATES_PROVIDER=live のとき 5 分ごとに外部レート取得
 */
export async function runMaintenance(db: Db, config: AppConfig, fetcher: typeof fetch, now = new Date()): Promise<MaintenanceResult> {
  const expiredQuotes = (await db.rpc<number>('expire_fx_quotes')) ?? 0;
  const expiredSessions = (await db.rpc<number>('expire_checkout_sessions')) ?? 0;
  const requeued = (await db.rpc<number>('requeue_stale_webhook_deliveries')) ?? 0;
  const webhooks = await deliverDueWebhooks(db, fetcher, 50);

  let ratesRefreshed = false;
  let rateErrors: string[] = [];
  if (config.ratesProvider === 'live' && now.getUTCMinutes() % 5 === 0) {
    const r = await refreshRates(db, config, fetcher);
    ratesRefreshed = r.errors.length === 0;
    rateErrors = r.errors;
  }

  return {
    expired_fx_quotes: expiredQuotes,
    expired_checkout_sessions: expiredSessions,
    requeued_stale_deliveries: requeued,
    webhooks,
    rates_refreshed: ratesRefreshed,
    rate_errors: rateErrors,
  };
}
