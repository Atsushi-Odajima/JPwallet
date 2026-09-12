<!-- English version of docs/api.md — keep both files in sync -->
# payCcount Merchant API Reference (Demo)

> This is a demo application. No real funds are handled. Every response carries the `X-Demo-Mode: true` and `X-Request-Id` headers.

- Base URL: `{{API_URL}}`
- Checkout page: `{{APP_URL}}/checkout/{session_id}`
- SDK: `@payccount/js` (`packages/sdk`)

## 1. Authentication

```
Authorization: Bearer sk_test_xxxxxxxx
```

You issue API keys from the merchant dashboard (Developers). The plaintext key is shown only once, at the time it is issued; the server stores only its SHA-256 hash. A revoked key returns `401 authentication_error`.

## 2. Common rules

| Item | Details |
|---|---|
| Amounts | Specify **integers in the smallest unit, as strings** (JPY: yen, USD/EUR/GBP: cents, BTC: satoshi, ETH: wei, PT: points) |
| Idempotency | The `Idempotency-Key` header is **required** on every `POST`. Same key + same body → same response (`Idempotency-Replayed: true`). Same key + different body → `409 idempotency_error` |
| IDs | Prefixed: `cs_` (Session), `pay_` (payment), `re_` (refund), `evt_` (event), `wh_` (webhook endpoint), `whd_` (delivery) |
| Rate limiting | 60 requests/minute per API key. Exceeding it returns `429 rate_limited` (`Retry-After`, `X-RateLimit-Remaining`) |
| Pagination | `?limit=20&starting_after=<id>` → `{ "data": [...], "has_more": true }` |
| Timestamps | ISO 8601 (UTC) |

### Error format

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "currency_not_supported",
    "message": "currency は加盟店の精算通貨（JPY）と一致させてください",
    "param": "currency"
  }
}
```

| HTTP | type | Typical codes |
|---|---|---|
| 400 | `invalid_request_error` | `invalid_request`, `invalid_amount`, `currency_not_supported`, `idempotency_key_required`, `refund_exceeds_payment`, `session_not_open` |
| 401 | `authentication_error` | `missing_api_key`, `invalid_api_key` |
| 402 | `insufficient_funds` | `insufficient_funds` (the merchant balance is insufficient to cover a refund) |
| 404 | `not_found` | `session_not_found`, `payment_not_found`, `refund_not_found`, `event_not_found` |
| 409 | `idempotency_error` | `idempotency_key_reused` |
| 410 | `invalid_request_error` | `session_expired` |
| 429 | `rate_limited` | `rate_limited` |
| 500 | `api_error` | `internal_error` |

## 3. Checkout Session

### `POST /v1/checkout/sessions`

```json
{
  "amount": "5980",
  "currency": "JPY",
  "order_id": "ORDER-1001",
  "description": "Item A ×1",
  "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
  "cancel_url": "https://shop.example/cart",
  "accepted_sources": ["JPY", "PT", "USD", "EUR", "GBP", "BTC", "ETH"],
  "metadata": { "customer_id": "c_123" }
}
```

- `currency` must **match the merchant's settlement currency** (for example JPY for a domestic store, USD for an international store)
- `accepted_sources` lists the currencies the customer can pay with. Omit it to accept every currency. Amounts in a different currency are converted at the mid rate × (1 − spread) and shown to the customer as the amount due
- `{CHECKOUT_SESSION_ID}` in `success_url` is replaced with the Session ID when the payment completes
- Sessions expire after 30 minutes. `checkout.session.expired` is emitted when a Session expires

Response `201`:

```json
{
  "id": "cs_9f1e…", "object": "checkout.session", "status": "open",
  "url": "{{APP_URL}}/checkout/cs_9f1e…",
  "amount": "5980", "currency": "JPY", "order_id": "ORDER-1001",
  "accepted_sources": ["JPY","PT","USD","EUR","GBP","BTC","ETH"],
  "payment_id": null, "expires_at": "…", "created_at": "…", "demo": true
}
```

### `GET /v1/checkout/sessions/:id`

### `POST /v1/checkout/sessions/:id/expire`

Expires an `open` Session (emits `checkout.session.expired`).

## 4. Payments

### `GET /v1/payments?limit=&starting_after=&status=`

`status`: `succeeded` | `partially_refunded` | `refunded`

### `GET /v1/payments/:id`

```json
{
  "id": "pay_…", "object": "payment", "session_id": "cs_…", "order_id": "ORDER-1001",
  "source_currency": "BTC", "source_amount": "50495",
  "settlement_currency": "USD", "settlement_amount": "4999",
  "fx_rate": "99000", "mid_rate": "100000", "spread_bps": 100,
  "fee_amount": "79", "fee_bps": 160, "net_amount": "4920",
  "status": "succeeded", "refunded_amount": "0", "refunded_source_amount": "0",
  "refunds": [], "created_at": "…", "demo": true
}
```

- `source_*`: the currency and amount the customer paid. `settlement_*`: the currency and amount the merchant receives
- `fx_rate`: 1 source = fx_rate settlement (the effective rate, spread included)
- `fee_amount` is the settlement amount × 1.6% (rounded down). `net_amount` is what is credited to the merchant balance

## 5. Refunds

### `POST /v1/payments/:id/refunds`

```json
{ "amount": "1000", "reason": "requested_by_customer" }
```

- `amount` is in the smallest unit of the settlement currency. Omit it to refund the full remaining amount. You can issue multiple partial refunds; if the cumulative total exceeds the payment amount, you get `400 refund_exceeds_payment`
- The customer is refunded in the **original payment source currency**, prorated at the rate used at payment time (`source_amount × amount / settlement_amount`; the final refund returns everything that remains). Any FX difference is absorbed by the operator's pool accounts
- Fees are not refunded. Because the refund amount is deducted from the merchant balance, an insufficient balance returns `402 insufficient_funds`
- `payment.refunded` is emitted

Response `201`:

```json
{ "id": "re_…", "object": "refund", "payment_id": "pay_…", "amount": "1000", "currency": "USD", "source_amount": "10101", "source_currency": "BTC", "reason": "requested_by_customer", "status": "succeeded", "created_at": "…", "demo": true }
```

### `GET /v1/refunds/:id`

## 6. Balance

### `GET /v1/balance`

```json
{ "object": "balance", "available": [{ "currency": "USD", "amount": "3920" }], "pending": [], "demo": true }
```

### `GET /v1/balance/transactions?limit=&starting_after=`

The debits and credits on the merchant account (ledger lines). `type` is one of `payment` / `refund` / `payout`.

## 7. Webhooks

### `POST /v1/webhook_endpoints`

```json
{ "url": "https://shop.example/api/webhook", "events": ["payment.succeeded", "payment.refunded", "checkout.session.completed"] }
```

Omit `events` to subscribe to all events (`["*"]`). The `secret` in the response (`whsec_…`) is returned **only at creation**.

### `GET /v1/webhook_endpoints` / `DELETE /v1/webhook_endpoints/:id`

### Event types

| type | When | `data.object` |
|---|---|---|
| `checkout.session.completed` | The customer completed the payment | Checkout Session |
| `checkout.session.expired` | The Session expired / the expire API was called | Checkout Session |
| `payment.succeeded` | The payment succeeded (at the same time the Session completes) | Payment |
| `payment.refunded` | A refund was issued (partial or full) | Payment (includes `refund`) |
| `payout.paid` | (P1) Payout | Payout |

### Payload

```json
{
  "id": "evt_…",
  "type": "payment.succeeded",
  "created": 1735689600,
  "demo": true,
  "data": { "object": { "id": "pay_…", "order_id": "ORDER-1001", "...": "..." } }
}
```

### Verifying signatures

```
X-payCcount-Signature: t=1735689600,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

`v1 = hex(HMAC-SHA256(secret, t + "." + rawBody))`. Reject the event if `t` differs from the current time by 300 seconds or more. SDK:

```ts
import { constructEvent } from '@payccount/js/webhooks';
const event = await constructEvent(rawBody, request.headers.get('X-payCcount-Signature'), process.env.PAYCCOUNT_WEBHOOK_SECRET);
```

### Delivery and retries

- Delivered asynchronously immediately after the payment. A non-2xx response, a timeout (10 seconds), or a connection failure counts as a failed delivery
- On failure, delivery is retried up to 5 times at intervals of **1 min → 5 min → 30 min → 2 hours → 12 hours** (Cron)
- Resend manually from the dashboard (Developers → Event log) or with `POST /v1/events/:id/resend`
- The response status code and the first 1 KB of the response body are stored and can be viewed in the dashboard
- The same event may be delivered more than once. Deduplicate by `id` (`evt_…`)

### `GET /v1/events?limit=&starting_after=&type=` / `GET /v1/events/:id` / `POST /v1/events/:id/resend`

## 8. Payment flow (summary)

1. Merchant server: `POST /v1/checkout/sessions` → `url`
2. Redirect the customer to `url`. If they are not signed in, they are returned to it after signing in
3. The customer chooses a payment source from JPY / PT / USD / EUR / GBP / BTC / ETH and clicks "Pay"
4. The server-side RPC `execute_payment` runs in a single transaction: debit the user's account (source) → if the currency differs, convert to the settlement currency via `fx_pool` / `crypto_custody` → credit `settlement − fee` to the merchant account and the fee to `fee_revenue` → mark the Session `completed`
5. Deliver `payment.succeeded` and `checkout.session.completed` via webhook
6. Redirect to `success_url` (with `{CHECKOUT_SESSION_ID}` replaced)
7. Refund with `POST /v1/payments/:id/refunds`

## 9. Test values

| Item | Value |
|---|---|
| API key | `sk_test_…` (test mode only) |
| Test cards for top-ups during Checkout | `4242424242424242` succeeds / `4000000000000002` fails |
| Exchange rates (mock) | USD/JPY 150, EUR/JPY 162, GBP/JPY 190, BTC/JPY 15,000,000, ETH/JPY 500,000 |
| Spread | FX 0.5%, crypto 1.0% |
| Payment fee | 1.6% |
