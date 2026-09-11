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

/** POST /mock/rates/set — デモ中に為替レートを動かす */
mockRoutes.post('/mock/rates/set', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      base: z.string().trim().min(2).max(5).toUpperCase(),
      quote: z.string().trim().min(2).max(5).toUpperCase(),
      rate: z.string().refine((s) => /^\d+(\.\d+)?$/.test(s) && Number(s) > 0, 'rate は正の 10 進数文字列で指定してください'),
    }),
  );
  const rate = await c.var.db.rpc('set_rate', { p_base: body.base, p_quote: body.quote, p_rate: body.rate, p_source: 'mock' });
  return c.json(rate);
});

/** POST /mock/crypto/set-price — クリプト価格を動かす { asset, quote, price } */
mockRoutes.post('/mock/crypto/set-price', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      asset: z.enum(['BTC', 'ETH']),
      quote: z.literal('JPY').default('JPY'),
      price: z.string().refine((s) => /^\d+(\.\d+)?$/.test(s) && Number(s) > 0, 'price は正の 10 進数文字列で指定してください'),
    }),
  );
  const rate = await c.var.db.rpc('set_rate', { p_base: body.asset, p_quote: body.quote, p_rate: body.price, p_source: 'mock' });
  return c.json(rate);
});

/**
 * POST /mock/crypto/deposit — 模擬ネットワークからの入金 { asset, to_address, amount, tx_hash?, from_address? }
 * TODO(real): 実際のブロックチェーン監視はスコープ外（デモ）
 */
mockRoutes.post('/mock/crypto/deposit', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      asset: z.enum(['BTC', 'ETH']),
      to_address: z.string().trim().min(10).max(120),
      amount: minorAmount,
      tx_hash: z.string().trim().min(8).max(80).optional(),
      from_address: z.string().trim().max(120).optional(),
    }),
  );
  const result = await c.var.db.rpc<{ status: string }>('process_crypto_deposit', {
    p_asset: body.asset,
    p_to_address: body.to_address,
    p_amount: body.amount,
    p_tx_hash: body.tx_hash ?? null,
    p_from_address: body.from_address ?? null,
  });
  return c.json(result, result.status === 'duplicate' ? 200 : 201);
});

/** POST /mock/maintenance/run — Cron 相当の保守処理（期限切れ Quote 掃除・Webhook 再送）を手動実行 */
mockRoutes.post('/mock/maintenance/run', async (c) => {
  const { runMaintenance } = await import('../services/maintenance');
  const result = await runMaintenance(c.var.db, c.var.config, fetch, new Date());
  return c.json(result);
});

/** POST /mock/rates/refresh — RATES_PROVIDER=live なら外部から取得、mock ならシード値に戻す */
mockRoutes.post('/mock/rates/refresh', async (c) => {
  const { refreshRates } = await import('../services/rates');
  const result = await refreshRates(c.var.db, c.var.config, fetch);
  return c.json(result);
});
