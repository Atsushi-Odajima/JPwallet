import type { Page, Topup, VirtualBankAccount } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { INVALID_TEST_CARD_MESSAGE, cardBrand, cardSchema, isExpValid, testCardOutcome } from '../lib/cards';
import { ApiError } from '../lib/errors';
import { minorAmount, paginationQuery, parseBody, parseQuery } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/** チャージ（模擬カード / 模擬銀行振込） */
export const topupRoutes = new Hono<AppEnv>();

topupRoutes.use('/me/topups/*', requireUser);
topupRoutes.use('/me/topups', requireUser);

/**
 * POST /me/topups/card
 * テスト番号: 4242424242424242 → 成功 / 4000000000000002 → 失敗（402） / それ以外 → 400
 * TODO(real): 実際のカード決済プロバイダ連携はスコープ外（デモ）
 */
topupRoutes.post('/me/topups/card', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      amount: minorAmount,
      currency: z.literal('JPY').default('JPY'),
      card: cardSchema,
    }),
  );
  const amount = BigInt(body.amount);
  if (amount < 100n) throw ApiError.badRequest('amount_too_small', 'チャージは ¥100 以上から可能です', 'amount');
  if (amount > 1_000_000n) throw ApiError.badRequest('amount_too_large', '1 回のチャージ上限は ¥1,000,000 です', 'amount');
  if (!isExpValid(body.card.exp, new Date())) throw ApiError.badRequest('card_expired', 'カードの有効期限が切れています', 'card.exp');

  const number = body.card.number;
  const last4 = number.slice(-4);
  const brand = cardBrand(number);
  const outcome = testCardOutcome(number);
  const idemHeader = c.req.header('Idempotency-Key');
  const idempotencyKey = idemHeader ? `topup_card:${c.var.user!.id}:${idemHeader}` : null;

  if (outcome === 'succeeded') {
    const topup = await c.var.db.rpc<Topup>('topup_card', {
      p_user_id: c.var.user!.id,
      p_amount: body.amount,
      p_currency: body.currency,
      p_outcome: 'succeeded',
      p_card_last4: last4,
      p_card_brand: brand,
      p_failure_reason: null,
      p_idempotency_key: idempotencyKey,
    });
    return c.json(topup, 201);
  }
  if (outcome === 'declined') {
    await c.var.db.rpc<Topup>('topup_card', {
      p_user_id: c.var.user!.id,
      p_amount: body.amount,
      p_currency: body.currency,
      p_outcome: 'failed',
      p_card_last4: last4,
      p_card_brand: brand,
      p_failure_reason: 'card_declined',
      p_idempotency_key: null,
    });
    throw new ApiError(402, 'invalid_request_error', 'card_declined', 'カードが拒否されました（テスト用の失敗カード）', 'card.number');
  }
  throw ApiError.badRequest('invalid_test_card', INVALID_TEST_CARD_MESSAGE, 'card.number');
});

topupRoutes.get('/me/topups', async (c) => {
  const q = parseQuery(c, paginationQuery);
  const page = await c.var.db.rpc<Page<Topup>>('list_topups', {
    p_user_id: c.var.user!.id,
    p_limit: q.limit,
    p_starting_after: q.starting_after ?? null,
  });
  return c.json(page);
});

/** 模擬振込先の発行（既存なら返す） */
topupRoutes.post('/me/topups/bank/virtual-account', async (c) => {
  const va = await c.var.db.rpc<VirtualBankAccount>('issue_virtual_bank_account', { p_user_id: c.var.user!.id });
  return c.json(va, 201);
});
topupRoutes.get('/me/topups/bank/virtual-account', async (c) => {
  const va = await c.var.db.rpc<VirtualBankAccount>('issue_virtual_bank_account', { p_user_id: c.var.user!.id });
  return c.json(va);
});

/** 自分の振込先に届いた入金通知 */
topupRoutes.get('/me/topups/bank/deposits', async (c) => {
  const res = await c.var.db.rpc('list_bank_deposits', { p_user_id: c.var.user!.id, p_limit: 20 });
  return c.json(res);
});
