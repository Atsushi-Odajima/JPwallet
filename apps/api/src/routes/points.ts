import type { Page, PointCampaign, PointPurchase } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { INVALID_TEST_CARD_MESSAGE, cardBrand, cardSchema, isExpValid, testCardOutcome } from '../lib/cards';
import { ApiError } from '../lib/errors';
import { minorAmount, parseBody } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/** ポイント（PT）: 購入 3 経路（JPY 残高 / 模擬カード / 模擬銀行振込）、キャンペーン */
export const pointsRoutes = new Hono<AppEnv>();

pointsRoutes.use('/me/points/*', requireUser);

pointsRoutes.get('/me/points/campaigns', async (c) => {
  const res = await c.var.db.rpc<{ data: PointCampaign[] }>('list_point_campaigns', { p_active_only: true });
  return c.json(res);
});

pointsRoutes.get('/me/points/purchases', async (c) => {
  const page = await c.var.db.rpc<Page<PointPurchase>>('list_point_purchases', { p_user_id: c.var.user!.id, p_limit: 20 });
  return c.json(page);
});

/**
 * POST /me/points/purchase { amount_jpy, method: card | bank_transfer | wallet_jpy, card? }
 *   - wallet_jpy: JPY 残高から即時付与
 *   - card      : テスト番号で成功 / 失敗（402）
 *   - bank_transfer: 振込識別コードを発行して pending。入金通知の照合で付与される
 */
pointsRoutes.post('/me/points/purchase', async (c) => {
  const body = await parseBody(
    c,
    z
      .object({
        amount_jpy: minorAmount,
        method: z.enum(['card', 'bank_transfer', 'wallet_jpy']),
        card: cardSchema.optional(),
      })
      .refine((v) => v.method !== 'card' || !!v.card, { message: 'カード情報が必要です', path: ['card'] }),
  );
  const amount = BigInt(body.amount_jpy);
  if (amount < 100n) throw ApiError.badRequest('amount_too_small', 'ポイント購入は ¥100 以上から可能です', 'amount_jpy');
  if (amount > 1_000_000n) throw ApiError.badRequest('amount_too_large', '1 回の購入上限は ¥1,000,000 です', 'amount_jpy');

  const idemHeader = c.req.header('Idempotency-Key');
  const idempotencyKey = idemHeader ? `point_purchase:${c.var.user!.id}:${idemHeader}` : null;

  let outcome: 'succeeded' | 'failed' = 'succeeded';
  let last4: string | null = null;
  if (body.method === 'card') {
    const card = body.card!;
    if (!isExpValid(card.exp, new Date())) throw ApiError.badRequest('card_expired', 'カードの有効期限が切れています', 'card.exp');
    const result = testCardOutcome(card.number);
    if (result === 'invalid') throw ApiError.badRequest('invalid_test_card', INVALID_TEST_CARD_MESSAGE, 'card.number');
    outcome = result === 'succeeded' ? 'succeeded' : 'failed';
    last4 = card.number.slice(-4);
  }

  const purchase = await c.var.db.rpc<PointPurchase>('purchase_points', {
    p_user_id: c.var.user!.id,
    p_amount_jpy: body.amount_jpy,
    p_method: body.method,
    p_outcome: outcome,
    p_card_last4: last4,
    p_idempotency_key: outcome === 'succeeded' ? idempotencyKey : null,
  });

  if (body.method === 'card' && outcome === 'failed') {
    throw new ApiError(402, 'invalid_request_error', 'card_declined', `カードが拒否されました（${cardBrand(body.card!.number)} ****${last4}、テスト用の失敗カード）`, 'card.number');
  }
  return c.json(purchase, 201);
});
