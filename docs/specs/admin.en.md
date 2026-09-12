<!-- English version of docs/specs/admin.ja.md — keep both files in sync -->
# payCcount Operator / Administrator Specification

| Item | Details |
|---|---|
| Audience | Administrators who operate payCcount (users of the admin console, operations staff and maintenance staff) |
| Version | 1.0 (2026-09-12) |
| Prerequisites | payCcount is a **demo application**. The administrator account uses fixed values; they must be changed before any use outside the demo |
| Related documents | [Merchant Payment Integration Specification](merchant.en.md), [Top-up Integration Specification](provider.en.md), [API Reference](../api.en.md), [Architecture](../architecture.md), [Deployment Guide](../deploy.md) |

---

## 1. Role of the operator

The operator (system) holds the following accounts and functions, separate from users and merchants.

| Role | Details |
|---|---|
| FX pool (`fx_pool`) | Counterparty account for currency exchange and cross-currency payments. Spread gains accumulate here |
| Crypto custody (`crypto_custody`) | Counterparty account for BTC / ETH trading and deposits / withdrawals (simulated) |
| Points issuer (`points_issuer`) | Issues PT, and settles JPY to the merchant when a payment is made with PT |
| Fee revenue (`fee_revenue`) | Receives the merchant payment fee (1.6%) |
| Card clearing / bank clearing (`card_clearing` / `bank_clearing`) | Receivables and funds held for the money that backs top-ups |
| Supervision | Viewing all users, merchants, payments, the ledger, webhook deliveries and audit logs; creating merchants and campaigns; running maintenance jobs manually |

## 2. Administrator account and authentication

| Item | Specification |
|---|---|
| Account | ID `kuro` (fixed UUID `00000000-0000-4000-8000-000000000001`, `profiles.role = 'admin'`). Created by the seed |
| Production (Supabase Auth) | Email `kuro@payccount.demo` + password. The "Admin" tab on the login screen automatically converts the ID `kuro` to this email address |
| Local (demo authentication) | `POST /auth/demo/admin-login` verifies the ID / password against `admin_credentials` (bcrypt) |
| Permissions | `/admin/*` (API and screens) accepts only JWTs with `role = 'admin'`. Roles are managed in the `profiles` table and checked in the API layer (not a development flag) |
| General features for administrators | Administrators can also use the wallet (balances, top-ups, payments) and the merchant dashboard. In the demo, the administrator is the owner of the sample EC merchants |
| Caution | The ID / password are fixed demo values. For any use outside the demo, change the seed and update the password on the Supabase side |

## 3. Admin console (`/admin/*`)

Every screen is available in Japanese and English and can be viewed at phone width (tables scroll horizontally inside their cards).

| Screen | Path | Contents |
|---|---|---|
| Overview | `/admin` | Counts (users, merchants, payments / refunds, journal entries, open checkouts, webhooks pending / failed), ledger integrity (OK / FAIL, entry count, line count, time checked), system account balances, user balances / merchant balances totalled per currency, payment volume (by settlement currency, fees, refunds), rate list (value and source), recent journal entries, **"Run maintenance (same as Cron)"** |
| Users | `/admin/users` | Search (email / display name), list (role, balances, JPY equivalent, number of shops / payments), details (profile, simulated bank account, balances in every currency, owned merchants, recent transactions) |
| Merchants | `/admin/merchants` | List (owner, settlement currency, fee, balance, payment count, registration date), **create a merchant and issue its first API key** (the key is shown only once) |
| Payments | `/admin/payments` | Payments across all merchants (payer, amount and currency paid, settlement amount, fee, rate and spread, status), the latest 100 Checkout Sessions (status, expiry) |
| Ledger | `/admin/ledger` | Integrity check (re-check), journal browser (filter by type; owner, currency and change for each line; reference ID), list of all accounts (type, owner, currency, balance) |
| Webhooks | `/admin/webhooks` | Deliveries across all merchants (filter by status; event, URL, attempts, HTTP status, next retry, error), **"Deliver due webhooks now"** |
| Campaigns | `/admin/campaigns` | List of point campaigns (bonus rate, minimum amount, period, active) and creation |
| Audit log | `/admin/audit` | Records of merchant creation, API key issuance / revocation, payments, refunds and Checkout cancellations |

## 4. Admin API (`/admin/*`)

| Method / path | Details |
|---|---|
| `GET /admin/overview` | Overview (the aggregates in §3) |
| `GET /admin/ledger/verify` | Ledger integrity check |
| `GET /admin/accounts` | All accounts |
| `GET /admin/journals?limit=&starting_after=&type=` | Journal entries (with lines and owners) |
| `GET /admin/users?limit=&q=` / `GET /admin/users/:id` | User list / details |
| `GET /admin/merchants` / `POST /admin/merchants` | Merchant list / creation (`name`, `country`, `settlement_currency`, `website_url`, `owner_user_id`; the administrator is used when `owner_user_id` is omitted) + first API key |
| `GET /admin/payments` / `GET /admin/checkout-sessions` | Payments / Sessions |
| `GET /admin/webhooks/deliveries?status=&limit=` | Webhook deliveries |
| `POST /admin/maintenance/run` | Run the maintenance jobs immediately (§6) |
| `GET /admin/audit-logs` | Audit logs |
| `GET /admin/point-campaigns` / `POST /admin/point-campaigns` | Campaign list (including inactive ones) / creation (`name`, `bonus_rate` e.g. `"0.02"`, `min_amount`, `active_from?`, `active_to`) |

All of these require a JWT with the administrator role. Some administrator operations (a merchant's API keys, webhooks and refunds) use the merchant dashboard API (`/me/merchants/*`) with administrator privileges.

## 5. Ledger (double-entry bookkeeping)

### 5.1 Model

```
accounts(owner_type user|merchant|system, owner_id, system_code, currency, balance)
journal_entries(id, type, idempotency_key, reference_type, reference_id, metadata, created_at)
ledger_lines(journal_id, account_id, amount signed, currency)
```

| Invariant | Details |
|---|---|
| Balanced | The sum of `amount` within the same journal entry and the same currency = 0 |
| Non-negative | Balances of `user` / `merchant` accounts ≥ 0 (system accounts may go negative, which represents "issued / held") |
| Consistent | `accounts.balance` = the sum of that account's `ledger_lines` |
| Idempotent | A journal entry with the same `idempotency_key` is never posted twice |
| Single path | Balances change only through business RPCs that go through the RPC `post_journal`. Neither the API layer nor the screens update balances directly |

### 5.2 Journal entry types and counterparty accounts

| type | Details | Main lines |
|---|---|---|
| `topup_card` | Card top-up | User JPY + / `card_clearing` − |
| `topup_bank` | Bank transfer top-up | User JPY + / `bank_clearing` − |
| `points_purchase` | Points purchase | Funding source (user JPY / `card_clearing` / `bank_clearing`) − → `points_issuer` JPY +, `points_issuer` PT − (bonus included) / user PT + |
| `fx_convert` | Currency exchange | User from − / `fx_pool` from + / `fx_pool` to − / user to + |
| `crypto_buy` / `crypto_sell` | Crypto trade | User JPY ∓ / `crypto_custody` JPY ± / `crypto_custody` asset ∓ / user asset ± |
| `crypto_deposit` / `crypto_withdrawal` | Simulated deposit / withdrawal | User asset ± / `crypto_custody` asset ∓ |
| `payment` | Merchant payment | User source − → via pool → merchant +net, `fee_revenue` +fee |
| `refund` | Refund | Merchant − → via pool (rate at payment time) → user source + |
| `adjustment` | Operator adjustment (currently not posted from the screens) | Any |

### 5.3 Integrity check

`GET /admin/ledger/verify` (the "Ledger" screen or `pnpm ledger:verify`) returns the following.

```json
{ "ok": true, "journal_count": 10, "line_count": 32, "unbalanced_journals": [], "negative_accounts": [], "balance_mismatches": [], "checked_at": "…" }
```

When `ok = false`, the offending IDs are listed in `unbalanced_journals` (journal entries that do not balance), `negative_accounts` (user / merchant accounts with a negative balance) and `balance_mismatches` (the cached balance differs from the line total). This cannot occur as long as the RPCs work correctly, so if it does, suspect a recent migration or manual SQL.

## 6. Scheduled jobs (Cron)

The Workers Cron (**every minute**) runs `runMaintenance`. "Run maintenance (same as Cron)" in the admin console and `POST /admin/maintenance/run` perform the same processing immediately.

| Job | Details |
|---|---|
| Expire FX quotes | Marks `open` quotes older than 60 seconds as `expired` |
| Expire Checkout Sessions | Marks `open` Sessions older than 30 minutes as `expired` and emits `checkout.session.expired` |
| Re-queue stale deliveries | Returns webhook deliveries that have been `in_flight` for 5 minutes or more to `pending` |
| Webhook delivery | Processes up to 50 due deliveries (tolerates concurrent runs via `skip locked`). Failures are retried after 1 min → 5 min → 30 min → 2 hours → 12 hours, and become `failed` after at most 5 attempts |
| Rate refresh | When `RATES_PROVIDER=live`, fetches from Frankfurter (USD / EUR / GBP → JPY) and CoinGecko (BTC / ETH → JPY) every 5 minutes. Currencies whose fetch fails keep their previous value |

Return value: `expired_fx_quotes`, `expired_checkout_sessions`, `requeued_stale_deliveries`, `webhooks { claimed, delivered, failed }`, `rates_refreshed`, `rate_errors[]`.

## 7. Operating parameters

### 7.1 The `config` table

| key | Default | Details |
|---|---|---|
| `merchant_fee_bps` | `160` | Merchant payment fee (1.6%) |
| `fx_spread_bps` | `50` | FX spread (0.5%) |
| `crypto_spread_bps` | `100` | Crypto trading spread (1.0%) |
| `checkout_session_ttl_minutes` | `30` | Checkout Session lifetime |
| `fx_quote_ttl_seconds` | `60` | FX quote lifetime |
| `refund_returns_fee` | `false` | Whether the payment fee is also returned on refund |

Changes are made with SQL (`update config set value = … where key = …`). Editing from the admin console is not provided. A fee change applies only to **subsequent payments** (existing Payments keep their `fee_bps`).

### 7.2 Rates

| Item | Details |
|---|---|
| Storage | `rates(base, quote='JPY', rate numeric(30,12), source, fetched_at)`. Stored as X/JPY; the RPCs compute inverse rates and cross rates via JPY |
| Seed | USD 150, EUR 162, GBP 190, BTC 15,000,000, ETH 500,000 (`source = seed`) |
| `RATES_PROVIDER` | `mock` (default; fixed values) / `live` (fetched externally every 5 minutes) |
| Changing rates during a demo | `POST /mock/rates/set { base, quote, rate }`, `POST /mock/crypto/set-price { asset, price }`, `POST /mock/rates/refresh` (re-fetches when live, restores the seed when mock). Available only when `DEMO_MOCK_ENDPOINTS=true` |

### 7.3 Environment variables (API)

| Variable | Details |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Production DB (PostgREST, service role). Locally, `DATABASE_URL` is used instead |
| `AUTH_MODE` | `supabase` (production) / `demo` (local; sign in with an email address only) |
| `JWT_SECRET` | Verification key for HS256 (Supabase legacy JWT secret / demo authentication). ES256 tokens are verified with Supabase's JWKS |
| `APP_URL` | Wallet URL (used for the Checkout `url`) |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) |
| `DEMO_MOCK_ENDPOINTS` | `true` enables `/mock/*` (**unauthenticated**; `false` in production-like environments) |
| `RATES_PROVIDER` | `mock` / `live` |

## 8. Webhook operations

| Status | Meaning | Action |
|---|---|---|
| `pending` | Awaiting retry (`next_retry_at`) | Wait, or "Deliver due webhooks now" |
| `in_flight` | Being sent | Automatically re-queued after more than 5 minutes |
| `delivered` | 2xx received | — |
| `failed` | Failed 5 times | Check the merchant's receiving endpoint. Resend from the merchant dashboard or with `POST /v1/events/:id/resend` (creates a new delivery record) |

For each delivery, the response status code, the first 1 KB of the response body and the error string are stored. Payments made while a merchant's receiving endpoint is down accumulate as failures and are delivered by resending once the endpoint recovers.

## 9. Campaign operations

| Item | Details |
|---|---|
| Contents | Bonus rate on point purchases (`bonus_rate`, e.g. `0.02` = +2%), minimum purchase amount (`min_amount`, in yen), period (`active_from` to `active_to`) |
| Application | Of the campaigns active at the time of purchase, the single one with the **highest bonus rate** |
| Journal entry | The bonus is issued by `points_issuer` without backing (a negative PT balance on `points_issuer` = points already issued) |
| Seed | "Demo launch campaign +1% (¥1,000 or more)" (`デモ開始キャンペーン +1%`) and "Bulk purchase +3% (¥10,000 or more)" (`まとめ買い +3%（¥10,000 以上）`) |
| Creation | The "Campaigns" screen in the admin console or `POST /admin/point-campaigns` |

## 10. Audit logs and notifications

### 10.1 Audit logs (`audit_logs`)

| action | Recorded when | actor / target |
|---|---|---|
| `merchant.create` | A merchant is created | user → merchant |
| `api_key.create` / `api_key.revoke` | An API key is issued / revoked | user → api_key |
| `payment.succeeded` | A payment is confirmed | user → payment (amount and currency) |
| `payment.refund` | A refund is issued | user (merchant owner) → refund (amount and payment_id) |
| `checkout.cancel` | The customer cancels the Checkout | user → checkout_session |

In addition, every merchant API request is recorded in `api_request_logs` (method, path, status, duration, Request-Id), and the latest 50 can be viewed in the merchant dashboard.

### 10.2 User notifications (`notifications`)

`topup_card` / `topup_bank` / `points_purchase` / `crypto_deposit` / `crypto_withdrawal` / `payment` / `refund`. They are shown under the bell in the wallet, with read / unread tracking.

## 11. Security

| Item | Specification |
|---|---|
| DB access | The API calls only PostgREST RPCs using the Supabase service role. It never accesses tables directly |
| RLS | Enabled on every table. Users see only their own rows, merchant data is visible only to its owner, and `anon` / `authenticated` are granted neither function execution nor table privileges |
| Authentication | Users / administrators use JWTs (HS256 with `JWT_SECRET`, ES256 with JWKS). Merchants use API keys (hash comparison). Administrators are identified by `role` |
| Secrets | API keys and webhook secrets are stored hashed or shown only at creation. Card numbers and CVCs are never stored |
| Rate limiting | The merchant API is limited to 60 req/min using a DB counter |
| Mocks | `/mock/*` is unauthenticated. Set `DEMO_MOCK_ENDPOINTS=false` in production-like environments |
| Auditing | §10 |

## 12. Deployment and environments

| Target | Service | Procedure |
|---|---|---|
| DB / authentication | Supabase (Postgres + Auth) | `scripts/deploy/deploy.sh supabase` (migrations, seed, Auth settings) |
| API | Cloudflare Workers (Cron every minute) | `deploy.sh api` (vars + secrets) |
| Wallet / dashboard / admin console | Cloudflare Pages | `deploy.sh web` |
| Sample EC | Cloudflare Pages + Functions + KV | `deploy.sh shops` (includes merchant registration and key / webhook issuance) |
| Verification | — | `deploy.sh smoke` (sign in → top-up → payment → webhook → ledger verification) |

Details and the required credentials are in [deploy.md](../deploy.md). The health check is `GET {API_URL}/health` (`{ ok, auth_mode, time }`).

## 13. Incident response (runbook)

| Symptom | Check | Action |
|---|---|---|
| Ledger integrity FAIL | `unbalanced_journals` / `negative_accounts` / `balance_mismatches` on the "Ledger" screen | Identify the affected journal entries and check for manual SQL or migrations. Correct with an `adjustment` entry if necessary |
| Webhooks not arriving | Status, HTTP status and error on the "Webhooks" screen | Check the merchant's receiving endpoint. After recovery, "Deliver due webhooks now" or resend |
| Rates not updating (live) | Rate source and `fetched_at` on the Overview | Re-fetch with `POST /mock/rates/refresh`. During an external API outage, operation continues with the previous values |
| Unmatched deposit (`unmatched`) | Deposit notification history in the user details | Check the virtual account number and resend the notification with the correct account number (using a different `external_ref`) |
| API returns 5xx | `X-Request-Id` and the Workers logs | Check DB reachability (Supabase) and secrets |
| Payment not possible (`insufficient_funds`) | The user's balance and the required converted amount | Working as specified. Sources with an insufficient balance are disabled on the Checkout page |

## 14. Limitations (demo)

- There is a single fixed administrator. There is no granular permission model (view-only, merchant management only, etc.).
- Fees, spreads and TTLs are changed with SQL (no screen).
- There are no operational features for adjustment entries, chargebacks, transfer recalls or payouts.
- All external connections (cards, banks, blockchains) are mocked. Rates are also fixed values by default.
- Backups, monitoring and alerting rely on the standard features of Supabase / Cloudflare.

## Appendix: Revision history

| Version | Date | Details |
|---|---|---|
| 1.0 | 2026-09-12 | First edition (based on the admin console and operational features from Phase 7) |
