import { getCurrency, type CurrencyCode } from './currencies';

/**
 * 金額ユーティリティ。
 * - 金額は「最小単位の整数」を文字列または bigint で扱う（Stripe と同じ考え方）
 * - 浮動小数点（number）で金額計算をしてはならない
 */

const MINOR_RE = /^-?\d+$/;

/** 最小単位の整数文字列かどうか */
export function isMinorString(v: unknown): v is string {
  return typeof v === 'string' && MINOR_RE.test(v);
}

/** 文字列/bigint → bigint。不正な値なら例外 */
export function toBigInt(v: string | bigint | number): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`amount must be an integer: ${v}`);
    return BigInt(v);
  }
  if (!isMinorString(v)) throw new Error(`invalid minor amount: ${v}`);
  return BigInt(v);
}

export function pow10(n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= 10n;
  return r;
}

export interface FormatOptions {
  /** 通貨記号を付ける（デフォルト true） */
  symbol?: boolean;
  /** 通貨コードを後ろに付ける */
  code?: boolean;
  /** 末尾の 0 を削る（クリプト向け） */
  trimZeros?: boolean;
  /** 表示小数桁数の上書き */
  displayDecimals?: number;
  /** 正の値に + を付ける */
  signed?: boolean;
}

/**
 * 最小単位の金額を表示用文字列に変換する。
 * formatAmount("150000", "USD") => "$1,500.00"
 * formatAmount("123456789", "BTC") => "₿1.23456789"
 */
export function formatAmount(minor: string | bigint, code: CurrencyCode | string, opts: FormatOptions = {}): string {
  const def = getCurrency(code);
  const value = toBigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = pow10(def.decimals);
  const intPart = abs / scale;
  let fracPart = abs % scale;

  const intStr = groupThousands(intPart.toString());
  let fracStr = '';
  if (def.decimals > 0) {
    fracStr = fracPart.toString().padStart(def.decimals, '0');
    const displayDecimals = opts.displayDecimals ?? def.displayDecimals;
    if (displayDecimals < def.decimals) {
      // 表示桁で切り捨て（金額表示で四捨五入はしない）
      fracStr = fracStr.slice(0, displayDecimals);
    }
    if (opts.trimZeros) {
      fracStr = fracStr.replace(/0+$/, '');
    }
  }
  fracPart = 0n;

  let body = fracStr.length > 0 ? `${intStr}.${fracStr}` : intStr;
  if (opts.symbol !== false) body = `${def.symbol}${body}`;
  if (opts.code) body = `${body} ${def.code}`;
  const sign = negative ? '-' : opts.signed ? '+' : '';
  return `${sign}${body}`;
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 表示用文字列（"1,500.25"）→ 最小単位の整数文字列（"150025"）。
 * 桁数が多すぎる・不正な文字がある場合は例外。
 */
export function parseAmount(display: string, code: CurrencyCode | string): string {
  const def = getCurrency(code);
  const cleaned = display.replace(/[,\s_]/g, '').replace(/^[¥$€£₿ΞP]/, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') throw new Error('empty amount');
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m) throw new Error(`invalid amount: ${display}`);
  const neg = m[1] === '-';
  const intStr = m[2] || '0';
  const fracStr = m[3] ?? '';
  if (fracStr.length > def.decimals) {
    throw new Error(`too many decimal places for ${def.code} (max ${def.decimals})`);
  }
  const padded = fracStr.padEnd(def.decimals, '0');
  const combined = (intStr + padded).replace(/^0+(?=\d)/, '');
  const value = BigInt(combined || '0');
  return (neg ? -value : value).toString();
}

/** 最小単位 → 表示用の小数文字列（記号なし、カンマなし）。入力欄の初期値などに使う */
export function minorToDecimalString(minor: string | bigint, code: CurrencyCode | string): string {
  const def = getCurrency(code);
  const value = toBigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = pow10(def.decimals);
  const intPart = (abs / scale).toString();
  if (def.decimals === 0) return `${negative ? '-' : ''}${intPart}`;
  const frac = (abs % scale).toString().padStart(def.decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${frac ? '.' + frac : ''}`;
}

export function addMinor(a: string | bigint, b: string | bigint): string {
  return (toBigInt(a) + toBigInt(b)).toString();
}

export function subMinor(a: string | bigint, b: string | bigint): string {
  return (toBigInt(a) - toBigInt(b)).toString();
}

export function compareMinor(a: string | bigint, b: string | bigint): -1 | 0 | 1 {
  const x = toBigInt(a);
  const y = toBigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isPositiveMinor(v: unknown): v is string {
  return isMinorString(v) && BigInt(v) > 0n;
}

/**
 * 表示専用の概算換算（サーバー側の RPC が正。フロントの参考表示にだけ使う）。
 * rate は "150.123456" のような 10進文字列。
 * from の最小単位 → to の最小単位（切り捨て）
 */
export function convertMinorApprox(
  fromMinor: string | bigint,
  from: CurrencyCode | string,
  to: CurrencyCode | string,
  rate: string,
): string {
  const f = getCurrency(from);
  const t = getCurrency(to);
  const { mantissa, scale } = parseDecimal(rate);
  // amount_to = amount_from / 10^f.dec * rate * 10^t.dec
  const num = toBigInt(fromMinor) * mantissa * pow10(t.decimals);
  const den = pow10(f.decimals) * pow10(scale);
  return floorDiv(num, den).toString();
}

export function parseDecimal(s: string): { mantissa: bigint; scale: number } {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) throw new Error(`invalid decimal: ${s}`);
  const frac = m[3] ?? '';
  const mantissa = BigInt((m[2] ?? '0') + frac) * (m[1] ? -1n : 1n);
  return { mantissa, scale: frac.length };
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  if (r !== 0n && (r < 0n) !== (b < 0n)) return q - 1n;
  return q;
}

/** レート文字列を表示用に丸める（表示専用） */
export function formatRate(rate: string, maxDecimals = 6): string {
  const { mantissa, scale } = parseDecimal(rate);
  const neg = mantissa < 0n;
  const abs = neg ? -mantissa : mantissa;
  const s = abs.toString().padStart(scale + 1, '0');
  const intPart = s.slice(0, s.length - scale) || '0';
  let frac = s.slice(s.length - scale);
  frac = frac.slice(0, maxDecimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${groupThousands(intPart)}${frac ? '.' + frac : ''}`;
}
