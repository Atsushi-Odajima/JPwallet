# payCcount 加盟店向け API リファレンス（デモ）

> これはデモアプリケーションです。実際の資金は扱いません。すべてのレスポンスに `X-Demo-Mode: true` と `X-Request-Id` が付きます。

- ベース URL: `{{API_URL}}`
- Checkout ページ: `{{APP_URL}}/checkout/{session_id}`
- SDK: `@payccount/js`（`packages/sdk`）

## 1. 認証

```
Authorization: Bearer sk_test_xxxxxxxx
```

APIキーは加盟店ダッシュボード（開発者）で発行します。平文は発行時に一度だけ表示され、サーバーには SHA-256 ハッシュのみ保存されます。失効したキーは `401 authentication_error` になります。

## 2. 共通ルール

| 項目 | 内容 |
|---|---|
| 金額 | **最小単位の整数を文字列**で指定（JPY: 円、USD/EUR/GBP: セント、BTC: satoshi、ETH: wei、PT: ポイント） |
| 冪等性 | `POST` には `Idempotency-Key` ヘッダーが**必須**。同一キー + 同一ボディ → 同じレスポンス（`Idempotency-Replayed: true`）。同一キー + 異なるボディ → `409 idempotency_error` |
| ID | 接頭辞付き: `cs_`（Session）`pay_`（決済）`re_`（返金）`evt_`（イベント）`wh_`（Webhook エンドポイント）`whd_`（配信） |
| レート制限 | APIキーごとに 60 req/分。超過で `429 rate_limited`（`Retry-After`, `X-RateLimit-Remaining`） |
| ページネーション | `?limit=20&starting_after=<id>` → `{ "data": [...], "has_more": true }` |
| 日時 | ISO 8601（UTC） |

### エラー形式

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

| HTTP | type | 代表的な code |
|---|---|---|
| 400 | `invalid_request_error` | `invalid_request`, `invalid_amount`, `currency_not_supported`, `idempotency_key_required`, `refund_exceeds_payment`, `session_not_open` |
| 401 | `authentication_error` | `missing_api_key`, `invalid_api_key` |
| 402 | `insufficient_funds` | `insufficient_funds`（返金時に加盟店残高が不足） |
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
  "description": "商品A ×1",
  "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
  "cancel_url": "https://shop.example/cart",
  "accepted_sources": ["JPY", "PT", "USD", "EUR", "GBP", "BTC", "ETH"],
  "metadata": { "customer_id": "c_123" }
}
```

- `currency` は**加盟店の精算通貨と一致**させます（国内EC: JPY、海外EC: USD など）
- `accepted_sources` はお客様が支払いに使える通貨。省略時は全通貨。異通貨はミッドレート × (1 − スプレッド) で換算され、お客様側に必要額として表示されます
- `success_url` の `{CHECKOUT_SESSION_ID}` は決済完了時に Session ID に置換されます
- 有効期限は 30 分。期限切れで `checkout.session.expired` が発行されます

レスポンス `201`:

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

`open` の Session を期限切れにします（`checkout.session.expired` を発行）。

## 4. 決済

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

- `source_*`: お客様が支払った通貨・額。`settlement_*`: 加盟店が受け取る通貨・額
- `fx_rate`: 1 source = fx_rate settlement（スプレッド込みの実効レート）
- `fee_amount` は精算額 × 1.6%（切り捨て）。加盟店残高には `net_amount` が入ります

## 5. 返金

### `POST /v1/payments/:id/refunds`

```json
{ "amount": "1000", "reason": "requested_by_customer" }
```

- `amount` は精算通貨の最小単位。省略で残り全額。部分返金を複数回できます。累計が決済額を超えると `400 refund_exceeds_payment`
- お客様には**元の支払ソース通貨**で、決済時の按分（`source_amount × amount / settlement_amount`、最後は残り全部）で返金されます。為替差は運営のプール勘定が吸収します
- 手数料は返金されません。返金額は加盟店残高から引かれるため、残高不足なら `402 insufficient_funds`
- `payment.refunded` が発行されます

レスポンス `201`:

```json
{ "id": "re_…", "object": "refund", "payment_id": "pay_…", "amount": "1000", "currency": "USD", "source_amount": "10101", "source_currency": "BTC", "reason": "requested_by_customer", "status": "succeeded", "created_at": "…", "demo": true }
```

### `GET /v1/refunds/:id`

## 6. 残高

### `GET /v1/balance`

```json
{ "object": "balance", "available": [{ "currency": "USD", "amount": "3920" }], "pending": [], "demo": true }
```

### `GET /v1/balance/transactions?limit=&starting_after=`

加盟店口座の入出金明細（台帳の仕訳行）。`type` は `payment` / `refund` / `payout`。

## 7. Webhook

### `POST /v1/webhook_endpoints`

```json
{ "url": "https://shop.example/api/webhook", "events": ["payment.succeeded", "payment.refunded", "checkout.session.completed"] }
```

`events` を省略すると全イベント（`["*"]`）。レスポンスの `secret`（`whsec_…`）は**作成時のみ**返ります。

### `GET /v1/webhook_endpoints` / `DELETE /v1/webhook_endpoints/:id`

### イベント種別

| type | タイミング | `data.object` |
|---|---|---|
| `checkout.session.completed` | お客様の支払い完了 | Checkout Session |
| `checkout.session.expired` | Session の期限切れ / expire API | Checkout Session |
| `payment.succeeded` | 決済成功（Session 完了と同時） | Payment |
| `payment.refunded` | 返金（部分・全額） | Payment（`refund` を含む） |
| `payout.paid` | （P1）出金 | Payout |

### ペイロード

```json
{
  "id": "evt_…",
  "type": "payment.succeeded",
  "created": 1735689600,
  "demo": true,
  "data": { "object": { "id": "pay_…", "order_id": "ORDER-1001", "...": "..." } }
}
```

### 署名の検証

```
X-payCcount-Signature: t=1735689600,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

`v1 = hex(HMAC-SHA256(secret, t + "." + rawBody))`。`t` が現在時刻から 300 秒以上ずれていれば拒否してください。SDK:

```ts
import { constructEvent } from '@payccount/js/webhooks';
const event = await constructEvent(rawBody, request.headers.get('X-payCcount-Signature'), process.env.PAYCCOUNT_WEBHOOK_SECRET);
```

### 配信とリトライ

- 決済直後に非同期で配信。2xx 以外・タイムアウト（10 秒）・接続失敗は失敗扱い
- 失敗時は **1分 → 5分 → 30分 → 2時間 → 12時間** の間隔で最大 5 回リトライ（Cron）
- ダッシュボード（開発者 → イベントログ）または `POST /v1/events/:id/resend` で手動再送
- レスポンスコードと本文の先頭 1KB を保存し、ダッシュボードで確認できます
- 同じイベントが複数回届くことがあります。`id`（`evt_…`）で重複排除してください

### `GET /v1/events?limit=&starting_after=&type=` / `GET /v1/events/:id` / `POST /v1/events/:id/resend`

## 8. 決済の流れ（まとめ）

1. 加盟店サーバー: `POST /v1/checkout/sessions` → `url`
2. お客様を `url` にリダイレクト。未ログインならログイン後に戻ります
3. お客様は JPY / PT / USD / EUR / GBP / BTC / ETH から支払ソースを選び「支払う」
4. サーバー側 RPC `execute_payment` が 1 トランザクションで: ユーザー口座（source）減算 → 異通貨なら `fx_pool` / `crypto_custody` 経由で精算通貨に換算 → 加盟店口座に `settlement − fee`、`fee_revenue` に fee → Session を `completed`
5. `payment.succeeded` と `checkout.session.completed` を Webhook 配信
6. `success_url` にリダイレクト（`{CHECKOUT_SESSION_ID}` 置換）
7. 返金は `POST /v1/payments/:id/refunds`

## 9. テスト用の値

| 項目 | 値 |
|---|---|
| APIキー | `sk_test_…`（テストモードのみ） |
| Checkout でのチャージ用テストカード | `4242424242424242` 成功 / `4000000000000002` 失敗 |
| 為替レート（mock） | USD/JPY 150、EUR/JPY 162、GBP/JPY 190、BTC/JPY 15,000,000、ETH/JPY 500,000 |
| スプレッド | 為替 0.5%、クリプト 1.0% |
| 決済手数料 | 1.6% |
