import type { FxQuote, Page, Rate } from '@payccount/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { currencyCode, minorAmount, parseBody, parseQuery } from '../lib/validate';
import { requireUser } from '../middleware/user-auth';
import type { AppEnv } from '../types';

/** レート参照（公開）と両替 Quote → Execute */
export const fxRoutes = new Hono<AppEnv>();

/** GET /rates?base=USD&quote=JPY — 現在レート（スプレッド前）。パラメータなしで全レート */
fxRoutes.get('/rates', async (c) => {
  const q = parseQuery(c, z.object({ base: currencyCode.optional(), quote: currencyCode.optional() }));
  if (q.base || q.quote) {
    const rate = await c.var.db.rpc<Rate>('get_rate_json', { p_base: q.base ?? 'JPY', p_quote: q.quote ?? 'JPY' });
    return c.json(rate);
  }
  const all = await c.var.db.rpc<{ data: Rate[] }>('list_rates');
  return c.json(all);
});

fxRoutes.use('/me/fx/*', requireUser);

fxRoutes.post('/me/fx/quotes', async (c) => {
  const body = await parseBody(
    c,
    z.object({
      from_currency: currencyCode,
      to_currency: currencyCode,
      from_amount: minorAmount,
    }),
  );
  const quote = await c.var.db.rpc<FxQuote>('create_fx_quote', {
    p_user_id: c.var.user!.id,
    p_from: body.from_currency,
    p_to: body.to_currency,
    p_from_amount: body.from_amount,
  });
  return c.json(quote, 201);
});

fxRoutes.get('/me/fx/quotes', async (c) => {
  const page = await c.var.db.rpc<Page<FxQuote>>('list_fx_quotes', { p_user_id: c.var.user!.id, p_limit: 20 });
  return c.json(page);
});

fxRoutes.get('/me/fx/quotes/:id', async (c) => {
  const quote = await c.var.db.rpc<FxQuote>('get_fx_quote', { p_user_id: c.var.user!.id, p_quote_id: c.req.param('id') });
  return c.json(quote);
});

/** 見積もりを確定して仕訳を起票。期限切れなら 410 */
fxRoutes.post('/me/fx/quotes/:id/execute', async (c) => {
  const quote = await c.var.db.rpc<FxQuote>('execute_fx_quote', { p_user_id: c.var.user!.id, p_quote_id: c.req.param('id') });
  return c.json(quote);
});
