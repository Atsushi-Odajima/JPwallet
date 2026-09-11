import type { CryptoOrder, CryptoPrices, CryptoWithdrawal, Page } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { minorAmount, parseBody, parseQuery } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/** クリプト（BTC / ETH）: 価格、売買、模擬入出金 */
export const cryptoRoutes = new Hono<AppEnv>();

const asset = z.enum(['BTC', 'ETH']);

/** GET /crypto/prices — { BTC: { JPY }, ETH: { JPY }, spread_bps, detail } */
cryptoRoutes.get('/crypto/prices', async (c) => {
  const prices = await c.var.db.rpc<CryptoPrices>('get_crypto_prices');
  return c.json(prices);
});

cryptoRoutes.use('/me/crypto/*', requireUser);

/** POST /me/crypto/orders { side, asset, quote_currency, asset_amount | quote_amount } */
cryptoRoutes.post('/me/crypto/orders', async (c) => {
  const body = await parseBody(
    c,
    z
      .object({
        side: z.enum(['buy', 'sell']),
        asset,
        quote_currency: z.literal('JPY').default('JPY'),
        asset_amount: minorAmount.optional(),
        quote_amount: minorAmount.optional(),
      })
      .refine((v) => (v.asset_amount ? !v.quote_amount : !!v.quote_amount), {
        message: 'asset_amount か quote_amount のどちらか一方を指定してください',
        path: ['asset_amount'],
      }),
  );
  const order = await c.var.db.rpc<CryptoOrder>('create_crypto_order', {
    p_user_id: c.var.user!.id,
    p_side: body.side,
    p_asset: body.asset,
    p_quote_currency: body.quote_currency,
    p_asset_amount: body.asset_amount ?? null,
    p_quote_amount: body.quote_amount ?? null,
  });
  return c.json(order, 201);
});

cryptoRoutes.get('/me/crypto/orders', async (c) => {
  const page = await c.var.db.rpc<Page<CryptoOrder>>('list_crypto_orders', { p_user_id: c.var.user!.id, p_limit: 20 });
  return c.json(page);
});

/** GET /me/crypto/deposit-address?asset=BTC — 固定の模擬アドレス */
cryptoRoutes.get('/me/crypto/deposit-address', async (c) => {
  const q = parseQuery(c, z.object({ asset }));
  const res = await c.var.db.rpc('get_crypto_deposit_address', { p_user_id: c.var.user!.id, p_asset: q.asset });
  return c.json(res);
});

cryptoRoutes.get('/me/crypto/deposits', async (c) => {
  const page = await c.var.db.rpc('list_crypto_deposits', { p_user_id: c.var.user!.id, p_limit: 20 });
  return c.json(page);
});

/** POST /me/crypto/withdrawals { asset, amount, to_address } → fake_tx_hash（模擬） */
cryptoRoutes.post('/me/crypto/withdrawals', async (c) => {
  const body = await parseBody(c, z.object({ asset, amount: minorAmount, to_address: z.string().trim().min(10).max(120) }));
  const w = await c.var.db.rpc<CryptoWithdrawal>('create_crypto_withdrawal', {
    p_user_id: c.var.user!.id,
    p_asset: body.asset,
    p_amount: body.amount,
    p_to_address: body.to_address,
  });
  return c.json(w, 201);
});

cryptoRoutes.get('/me/crypto/withdrawals', async (c) => {
  const page = await c.var.db.rpc<Page<CryptoWithdrawal>>('list_crypto_withdrawals', { p_user_id: c.var.user!.id, p_limit: 20 });
  return c.json(page);
});
