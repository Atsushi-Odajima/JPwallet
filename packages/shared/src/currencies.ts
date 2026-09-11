/**
 * 通貨定義。DB の currencies テーブルと同じ内容を型として持つ。
 * 金額はすべて「最小単位の整数（文字列）」で扱う。
 */
export type CurrencyKind = 'fiat' | 'crypto' | 'points';

export type FiatCurrency = 'JPY' | 'USD' | 'EUR' | 'GBP';
export type CryptoCurrency = 'BTC' | 'ETH';
export type PointsCurrency = 'PT';
export type CurrencyCode = FiatCurrency | CryptoCurrency | PointsCurrency;

export interface CurrencyDef {
  code: CurrencyCode;
  kind: CurrencyKind;
  /** 最小単位の桁数（JPY=0, USD=2, BTC=8, ETH=18） */
  decimals: number;
  /** 表示名（日本語） */
  name: string;
  /** 表示名（英語） */
  nameEn: string;
  /** 表示用の記号 */
  symbol: string;
  /** 表示時の小数桁数（0 なら decimals をそのまま使う） */
  displayDecimals: number;
}

export const CURRENCIES: Record<CurrencyCode, CurrencyDef> = {
  JPY: { code: 'JPY', kind: 'fiat', decimals: 0, name: '日本円', nameEn: 'Japanese Yen', symbol: '¥', displayDecimals: 0 },
  USD: { code: 'USD', kind: 'fiat', decimals: 2, name: '米ドル', nameEn: 'US Dollar', symbol: '$', displayDecimals: 2 },
  EUR: { code: 'EUR', kind: 'fiat', decimals: 2, name: 'ユーロ', nameEn: 'Euro', symbol: '€', displayDecimals: 2 },
  GBP: { code: 'GBP', kind: 'fiat', decimals: 2, name: '英ポンド', nameEn: 'British Pound', symbol: '£', displayDecimals: 2 },
  BTC: { code: 'BTC', kind: 'crypto', decimals: 8, name: 'ビットコイン', nameEn: 'Bitcoin', symbol: '₿', displayDecimals: 8 },
  ETH: { code: 'ETH', kind: 'crypto', decimals: 18, name: 'イーサリアム', nameEn: 'Ethereum', symbol: 'Ξ', displayDecimals: 6 },
  PT: { code: 'PT', kind: 'points', decimals: 0, name: 'payCcountポイント', nameEn: 'payCcount Points', symbol: 'P', displayDecimals: 0 },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];
export const FIAT_CODES: FiatCurrency[] = ['JPY', 'USD', 'EUR', 'GBP'];
export const CRYPTO_CODES: CryptoCurrency[] = ['BTC', 'ETH'];

/** 加盟店決済で支払ソースとして選べる通貨 */
export const PAYMENT_SOURCE_CODES: CurrencyCode[] = ['JPY', 'PT', 'USD', 'EUR', 'GBP', 'BTC', 'ETH'];

/** 加盟店の精算通貨として選べる通貨（法定通貨のみ） */
export const SETTLEMENT_CODES: FiatCurrency[] = ['JPY', 'USD', 'EUR', 'GBP'];

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && v in CURRENCIES;
}

export function getCurrency(code: string): CurrencyDef {
  const def = (CURRENCIES as Record<string, CurrencyDef>)[code];
  if (!def) throw new Error(`unknown currency: ${code}`);
  return def;
}
