import type { Db } from '../db/port';
import type { AppConfig } from '../env';
import { refreshRates } from './rates';

export interface MaintenanceResult {
  expired_fx_quotes: number;
  rates_refreshed: boolean;
  rate_errors: string[];
  webhook_deliveries?: unknown;
}

/**
 * Cron（毎分）で実行する保守処理。
 *   - 期限切れ FX Quote の掃除
 *   - RATES_PROVIDER=live のとき 5 分ごとに外部レート取得
 *   - Webhook 再送（Phase 5）
 */
export async function runMaintenance(db: Db, config: AppConfig, fetcher: typeof fetch, now = new Date()): Promise<MaintenanceResult> {
  const result: MaintenanceResult = { expired_fx_quotes: 0, rates_refreshed: false, rate_errors: [] };

  result.expired_fx_quotes = (await db.rpc<number>('expire_fx_quotes')) ?? 0;

  if (config.ratesProvider === 'live' && now.getUTCMinutes() % 5 === 0) {
    const r = await refreshRates(db, config, fetcher);
    result.rates_refreshed = r.errors.length === 0;
    result.rate_errors = r.errors;
  }

  return result;
}
