import type { Db } from '../db/port';
import type { AppConfig } from '../env';

export interface RefreshResult {
  provider: 'mock' | 'live';
  updated: { base: string; quote: string; rate: string; source: string }[];
  errors: string[];
}

/**
 * レート更新。
 *   - mock: シード値（USD/JPY=150 など）に戻す
 *   - live: 無料 API から取得（Phase 3 で実装。為替: Frankfurter、クリプト: CoinGecko）
 * レートは必ず rates テーブル経由で参照し、API から直接外部を叩かない。
 */
export async function refreshRates(db: Db, config: AppConfig, _fetcher: typeof fetch): Promise<RefreshResult> {
  if (config.ratesProvider === 'mock') {
    const rows = await db.rpc<{ base: string; quote: string; rate: string; source: string }[]>('reseed_rates');
    return { provider: 'mock', updated: rows ?? [], errors: [] };
  }
  // TODO(phase3): RATES_PROVIDER=live
  return { provider: 'live', updated: [], errors: ['live プロバイダは Phase 3 で実装します'] };
}
