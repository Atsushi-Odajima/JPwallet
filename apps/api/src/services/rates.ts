import type { Db } from '../db/port';
import type { AppConfig } from '../env';

export interface RefreshResult {
  provider: 'mock' | 'live';
  updated: { base: string; quote: string; rate: string; source: string }[];
  errors: string[];
}

/** 無認証で使える無料 API（RATES_PROVIDER=live のときだけ叩く） */
export const LIVE_SOURCES = {
  frankfurter: (base: string) => `https://api.frankfurter.app/latest?from=${base}&to=JPY`,
  coingecko: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=jpy',
} as const;

const FIAT_BASES = ['USD', 'EUR', 'GBP'] as const;
const COINS: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH' };

/**
 * レート更新。
 *   - mock: シード値（USD/JPY=150 など）に戻す
 *   - live: Frankfurter（為替）と CoinGecko（クリプト）から取得。失敗した通貨は前回値を維持する
 * レートは必ず rates テーブル経由で参照し、リクエスト処理中に外部を叩かない。
 */
export async function refreshRates(db: Db, config: AppConfig, fetcher: typeof fetch): Promise<RefreshResult> {
  if (config.ratesProvider === 'mock') {
    const rows = await db.rpc<{ base: string; quote: string; rate: string; source: string }[]>('reseed_rates');
    return { provider: 'mock', updated: rows ?? [], errors: [] };
  }

  const result: RefreshResult = { provider: 'live', updated: [], errors: [] };
  const timeout = (ms: number) => AbortSignal.timeout(ms);

  // 為替: Frankfurter（ECB ベース、無認証）
  for (const base of FIAT_BASES) {
    try {
      const res = await fetcher(LIVE_SOURCES.frankfurter(base), { signal: timeout(8000), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rates?: Record<string, number> };
      const value = json.rates?.JPY;
      if (typeof value !== 'number' || !(value > 0)) throw new Error('JPY レートがありません');
      const saved = await db.rpc<{ base: string; quote: string; rate: string; source: string }>('set_rate', {
        p_base: base,
        p_quote: 'JPY',
        p_rate: toDecimalString(value),
        p_source: 'frankfurter',
      });
      result.updated.push(saved);
    } catch (e) {
      result.errors.push(`${base}/JPY: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // クリプト: CoinGecko simple/price（無認証）
  try {
    const res = await fetcher(LIVE_SOURCES.coingecko, { signal: timeout(8000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as Record<string, { jpy?: number }>;
    for (const [id, code] of Object.entries(COINS)) {
      const value = json[id]?.jpy;
      if (typeof value !== 'number' || !(value > 0)) {
        result.errors.push(`${code}/JPY: 価格がありません`);
        continue;
      }
      const saved = await db.rpc<{ base: string; quote: string; rate: string; source: string }>('set_rate', {
        p_base: code,
        p_quote: 'JPY',
        p_rate: toDecimalString(value),
        p_source: 'coingecko',
      });
      result.updated.push(saved);
    }
  } catch (e) {
    result.errors.push(`crypto: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}

/** JSON の数値を指数表記なしの 10 進文字列にする（numeric(30,12) に収まる範囲） */
export function toDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new Error('invalid number');
  let s = n.toFixed(12);
  s = s.replace(/\.?0+$/, '');
  return s;
}
