import { CURRENCY_CODES, isMinorString } from '@payccount/shared';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../types';
import { ApiError } from './errors';

/** 最小単位の整数文字列（正の値） */
export const minorAmount = z
  .string()
  .refine((s) => isMinorString(s), { message: '金額は最小単位の整数文字列で指定してください（例: "1500"）' })
  .refine((s) => BigInt(s) > 0n, { message: '金額は 1 以上で指定してください' });

/** 0 以上の最小単位の整数文字列 */
export const minorAmountOrZero = z
  .string()
  .refine((s) => isMinorString(s) && BigInt(s) >= 0n, { message: '金額は 0 以上の整数文字列で指定してください' });

export const currencyCode = z.enum(CURRENCY_CODES as [string, ...string[]]);

export const idParam = z.string().min(1).max(200);

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  starting_after: z.string().min(1).optional(),
});

/** JSON ボディを zod で検証する。不正なら 400 */
export async function parseBody<T extends z.ZodTypeAny>(c: Context<AppEnv>, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  const text = await c.req.text();
  if (text.trim() === '') {
    raw = {};
  } else {
    try {
      raw = JSON.parse(text);
    } catch {
      throw ApiError.badRequest('invalid_json', 'JSON の形式が正しくありません');
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const param = issue?.path?.map(String).join('.') || undefined;
    throw ApiError.badRequest('invalid_request', issue ? `${param ? param + ': ' : ''}${issue.message}` : 'リクエストが不正です', param);
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(c: Context<AppEnv>, schema: T): z.infer<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    const issue = result.error.issues[0];
    const param = issue?.path?.map(String).join('.') || undefined;
    throw ApiError.badRequest('invalid_request', issue ? `${param ? param + ': ' : ''}${issue.message}` : 'クエリが不正です', param);
  }
  return result.data;
}
