import type { BankDepositNotification, Topup } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import { minorAmount, parseBody } from '../lib/validate';
import type { AppEnv } from '../types';

/**
 * C. モック用エンドポイント（/mock/*）。DEMO_MOCK_ENDPOINTS=true のときだけ有効。
 * 外部システム（銀行・為替・クリプト価格）からのイベントを手で発生させる。
 */
export const mockRoutes = new Hono<AppEnv>();

mockRoutes.use('/mock/*', async (c, next) => {
  if (!c.var.config.mockEndpoints) {
    throw ApiError.notFound('mock_disabled', 'モックエンドポイントは無効です（DEMO_MOCK_ENDPOINTS=true で有効化）');
  }
  await next();
});

interface DepositResult {
  status: 'processed' | 'unmatched' | 'duplicate' | 'rejected';
  notification: BankDepositNotification;
  topup: Topup | null;
}

/**
 * POST /mock/bank/deposit — 銀行からの「入金通知」を模擬する。
 * 実務と同じく: 通知受信 → 冪等チェック → 振込先照合 → 金額検証 → 仕訳 → ユーザー通知
 * TODO(real): 実際の銀行 API / 入金通知 Webhook の受信はスコープ外（デモ）
 */
mockRoutes.post('/mock/bank/deposit', async (c) => {
  const body = await parseBody(
    c,
    z
      .object({
        account_number: z.string().trim().min(1).optional(),
        virtual_account_id: z.string().uuid().optional(),
        amount: minorAmount,
        payer_name: z.string().trim().max(60).optional(),
        external_ref: z.string().trim().min(1).max(100).optional(),
      })
      .refine((v) => v.account_number || v.virtual_account_id, { message: 'account_number または virtual_account_id が必要です', path: ['account_number'] }),
  );

  let accountNumber = body.account_number;
  if (!accountNumber && body.virtual_account_id) {
    const va = await c.var.db.rpc<{ account_number: string } | null>('get_virtual_bank_account_by_id', { p_id: body.virtual_account_id });
    if (!va) throw ApiError.notFound('virtual_account_not_found', '振込先口座が見つかりません');
    accountNumber = va.account_number;
  }

  const result = await c.var.db.rpc<DepositResult>('process_bank_deposit', {
    p_account_number: accountNumber,
    p_amount: body.amount,
    p_payer_name: body.payer_name ?? null,
    p_external_ref: body.external_ref ?? null,
  });

  if (result.status === 'unmatched') {
    return c.json(
      {
        error: {
          type: 'not_found',
          code: 'virtual_account_not_found',
          message: '振込先口座が見つかりません（未照合入金として記録しました）',
          param: 'account_number',
        },
        notification: result.notification,
      },
      404,
    );
  }
  if (result.status === 'rejected') {
    return c.json(
      { error: { type: 'invalid_request_error', code: 'deposit_rejected', message: result.notification.reject_reason ?? '入金を処理できませんでした' }, notification: result.notification },
      400,
    );
  }
  return c.json(result, result.status === 'duplicate' ? 200 : 201);
});
