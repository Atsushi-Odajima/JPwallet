# Globe Goods — sample global store (USD)

A sample e-commerce site that accepts payCcount (demo) as a payment method. React + Vite frontend; Cloudflare Pages Functions (`functions/`) create Checkout Sessions and receive webhooks.

The merchant **settles in USD**. Japanese customers pay from their payCcount balance in **JPY, points, USD, BTC or ETH**; the Checkout page shows the converted amount and rate, and the merchant's USD balance grows.

> This is a demo. No real money moves.

## Layout

| Path | Purpose |
|---|---|
| `src/App.tsx` | Catalog, cart, checkout (`POST /api/checkout` → redirect to payCcount Checkout), orders, thank-you page |
| `functions/api/checkout.ts` | Recomputes the total from the server-side catalog and creates a Checkout Session with `@payccount/js` (idempotency key = order id) |
| `functions/api/webhook.ts` | Verifies `X-payCcount-Signature`, marks the order paid on `payment.succeeded`, dedupes by event id |
| `functions/api/orders/*` | Order list / detail including received webhooks |
| `functions/_lib/store.ts` | Order storage (KV `ORDERS`, falls back to memory) |
| `shop.config.ts` | Store name, currency, products, copy (English / USD) |

## Setup (register merchant → API key → run)

Prerequisites: from the repo root `pnpm install`, `pnpm db:start`, `pnpm dev` (API on http://localhost:8787, wallet on http://localhost:5173).

1. **Register the merchant**: sign in to the wallet (http://localhost:5173) → "加盟店ダッシュボード" → create store "Globe Goods", country US, settlement currency **USD**
2. **API key**: Developers → "新しいキーを発行" → copy `sk_test_…`
3. **Webhook**: Developers → add endpoint `http://localhost:5175/api/webhook` → copy `whsec_…`
4. Create `.dev.vars`:
   ```
   cp .dev.vars.example .dev.vars
   # paste PAYCCOUNT_SECRET_KEY and PAYCCOUNT_WEBHOOK_SECRET
   ```
5. Run `pnpm dev` (or `pnpm dev:shop-global` from the repo root) → http://localhost:5175
6. Add products, click "Pay with payCcount", pick **BTC** (or JPY / PT) on the Checkout page. You are redirected back and the order turns "Paid" within seconds when the webhook arrives. In the merchant dashboard the balance increases in USD; `fee_revenue` and `crypto_custody` / `fx_pool` receive the difference.
7. Refund from the merchant dashboard → `payment.refunded` arrives and the order status changes. The customer gets BTC back at the original rate.

## Deploy (Cloudflare Pages)

```
wrangler kv namespace create ORDERS        # put the id into wrangler.toml
pnpm build && wrangler pages deploy dist --project-name payccount-shop-global
```

Set `PAYCCOUNT_API_URL` / `PAYCCOUNT_SECRET_KEY` / `PAYCCOUNT_WEBHOOK_SECRET` / `SHOP_URL` in the Pages project and register the production webhook URL `https://<pages>/api/webhook`.
