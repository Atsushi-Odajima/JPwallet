import { describe, expect, it } from 'vitest';
import {
  addMinor,
  compareMinor,
  convertMinorApprox,
  formatAmount,
  formatRate,
  minorToDecimalString,
  parseAmount,
} from './money';

describe('formatAmount', () => {
  it('JPY は小数なし', () => {
    expect(formatAmount('1500', 'JPY')).toBe('¥1,500');
    expect(formatAmount('-1500', 'JPY')).toBe('-¥1,500');
    expect(formatAmount('0', 'JPY')).toBe('¥0');
  });
  it('USD は 2 桁', () => {
    expect(formatAmount('150000', 'USD')).toBe('$1,500.00');
    expect(formatAmount('5', 'USD')).toBe('$0.05');
  });
  it('BTC は 8 桁', () => {
    expect(formatAmount('123456789', 'BTC')).toBe('₿1.23456789');
    expect(formatAmount('100000000', 'BTC', { trimZeros: true })).toBe('₿1');
  });
  it('ETH は wei（18 桁）を表示桁 6 で切り捨て', () => {
    expect(formatAmount('1000000000000000000', 'ETH')).toBe('Ξ1.000000');
    expect(formatAmount('1234567890123456789', 'ETH')).toBe('Ξ1.234567');
    expect(formatAmount('1234567890123456789', 'ETH', { displayDecimals: 18, symbol: false })).toBe(
      '1.234567890123456789',
    );
  });
  it('コード付き・符号付き', () => {
    expect(formatAmount('100', 'PT', { symbol: false, code: true, signed: true })).toBe('+100 PT');
  });
});

describe('parseAmount', () => {
  it('表示文字列 → 最小単位', () => {
    expect(parseAmount('1,500', 'JPY')).toBe('1500');
    expect(parseAmount('1500.25', 'USD')).toBe('150025');
    expect(parseAmount('0.5', 'USD')).toBe('50');
    expect(parseAmount('.5', 'USD')).toBe('50');
    expect(parseAmount('1.5', 'BTC')).toBe('150000000');
    expect(parseAmount('0.000000000000000001', 'ETH')).toBe('1');
    expect(parseAmount('¥1,000', 'JPY')).toBe('1000');
  });
  it('桁数超過は例外', () => {
    expect(() => parseAmount('1.5', 'JPY')).toThrow();
    expect(() => parseAmount('1.005', 'USD')).toThrow();
  });
  it('不正な文字は例外', () => {
    expect(() => parseAmount('abc', 'JPY')).toThrow();
    expect(() => parseAmount('', 'JPY')).toThrow();
  });
  it('往復', () => {
    for (const [minor, code] of [
      ['123456789', 'BTC'],
      ['1500', 'JPY'],
      ['1', 'ETH'],
    ] as const) {
      expect(parseAmount(minorToDecimalString(minor, code), code)).toBe(minor);
    }
  });
});

describe('bigint 演算', () => {
  it('add / compare', () => {
    expect(addMinor('1', '2')).toBe('3');
    expect(compareMinor('10', '2')).toBe(1);
    expect(compareMinor('2', '10')).toBe(-1);
    expect(compareMinor('2', '2')).toBe(0);
  });
  it('ETH の wei は Number を超えても正しく扱える', () => {
    expect(addMinor('9007199254740993', '1')).toBe('9007199254740994');
  });
});

describe('convertMinorApprox', () => {
  it('USD → JPY', () => {
    // $10.00 × 150 = ¥1,500
    expect(convertMinorApprox('1000', 'USD', 'JPY', '150')).toBe('1500');
  });
  it('JPY → USD（切り捨て）', () => {
    // ¥1,000 × (1/150) = $6.666… → 666 cents
    expect(convertMinorApprox('1000', 'JPY', 'USD', '0.006666666667')).toBe('666');
  });
  it('BTC → JPY', () => {
    expect(convertMinorApprox('100000000', 'BTC', 'JPY', '15000000')).toBe('15000000');
  });
});

describe('formatRate', () => {
  it('表示用に丸める', () => {
    expect(formatRate('150.123456789012')).toBe('150.123456');
    expect(formatRate('15000000.000000000000')).toBe('15,000,000');
  });
});
