import { TEST_CARDS } from '@payccount/shared';
import { z } from 'zod';

/**
 * 模擬カード。デモではテスト番号だけを受け付ける。
 * TODO(real): 実際のカード決済プロバイダ連携はスコープ外
 */
export const cardSchema = z.object({
  number: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .refine((s) => /^\d{13,19}$/.test(s), 'カード番号は 13〜19 桁の数字で入力してください'),
  exp: z.string().refine((s) => /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/.test(s.trim()), '有効期限は MM/YY 形式で入力してください'),
  cvc: z.string().refine((s) => /^\d{3,4}$/.test(s), 'セキュリティコードは 3〜4 桁の数字です'),
  name: z.string().trim().max(60).optional(),
});
export type CardInput = z.infer<typeof cardSchema>;

export type CardOutcome = 'succeeded' | 'declined' | 'invalid';

/** テスト番号 → 結果。4242… 成功 / 4000…0002 失敗 / それ以外は不正 */
export function testCardOutcome(number: string): CardOutcome {
  if (number === TEST_CARDS.success) return 'succeeded';
  if (number === TEST_CARDS.declined) return 'declined';
  return 'invalid';
}

/** 有効期限が過去なら false */
export function isExpValid(exp: string, now: Date): boolean {
  const m = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(exp.trim());
  if (!m) return false;
  const month = Number(m[1]);
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  return endOfMonth.getTime() >= now.getTime();
}

export function cardBrand(number: string): string {
  if (number.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(number) || /^2[2-7]/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  if (/^35/.test(number)) return 'jcb';
  return 'card';
}

export const INVALID_TEST_CARD_MESSAGE = `デモではテスト用カード番号のみ使えます（成功: ${TEST_CARDS.success} / 失敗: ${TEST_CARDS.declined}）`;
