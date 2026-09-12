# アプリ名:payCcount — 日本産オンラインEウォレット（デモ）実装指示書

> このファイルはリポジトリ直下に `CLAUDE.md` として置き、Claude Code に読ませて実装を進めるための仕様書＋フェーズ計画です。

---

## 0. 前提

- **これはデモアプリケーションです。** 実際の資金・暗号資産・カード情報は扱わない。すべての外部決済・為替・ブロックチェーン連携はモック（模擬）で実装する。
- TOPページフッターに **「これはデモアプリケーションです。」** を表示する。表示は **TOP ページ（`/`）最下部のみ**。他の画面や上部の帯には出さない（2026-09-11 オーナー指示）。
- 法規制（資金決済法・暗号資産交換業・為替取引等）への対応は **スコープ外**。ライセンス要否は行わない。
- テスト用の固定値だけを受け付ける。
- 目的は **「クレジット決済・QR決済に続く第3の国内決済手段」という構想を、動くプロトタイプとして提示できること**。集客・収益性は評価対象外。設計の正しさ（台帳の整合性、API の使いやすさ、Webhook の信頼性）を優先する。

---

## 1. プロダクト概要

**payCcount** は、日本のユーザー向けオンラインEウォレット。以下を1つのアプリで提供する。

1. **現地通貨（JPY）残高の管理** — チャージ、残高確認、取引履歴
2. **マルチカレンシー** — JPY / USD / EUR / GBP を保有・両替
3. **主要クリプト** — BTC / ETH を保有・売買（模擬カストディ）
4. **ポイント購入** — 決済（模擬カード／模擬銀行振込）でアプリ内ポイントを購入し、決済に使用
5. **EC 決済 API** — 国内EC・海外ECが API / SDK で接続し、payCcount を決済手段として組み込める
6. **決済手段としての位置づけ** — 加盟店ダッシュボード、APIキー、Webhook、精算（売上残高）まで含めて「決済ブランド」として成立する形にする

### 1.1 登場人物（ペルソナ）

| 役割 | 説明 |
|---|---|
| **ユーザー** | ウォレットアプリ（PWA）を使う日本の消費者 |
| **加盟店（国内EC）** | 円建てで商品を売る。決済は JPY で精算 |
| **加盟店（海外EC）** | USD 建てで商品を売る。決済は USD で精算 |
| **運営（システム）** | 為替プール、クリプト・カストディ、ポイント発行元、手数料収益などのシステム勘定 |

### 1.2 ゴール / ノンゴール

**ゴール**
- 上記6機能がすべてブラウザ上で一通り動く
- 加盟店が **APIキー発行 → Checkout Session 作成 → ユーザー決済 → Webhook 受信 → 売上残高反映 → 返金** を実際に体験できる
- 内部台帳が複式簿記で一貫しており、どの操作の後も「全仕訳の合計 = 0」「ユーザー・加盟店口座の残高 ≥ 0」が成り立つ
- サンプルEC（国内・海外）が SDK 経由で決済できる

**ノンゴール（作らない）**
- 本物のカード決済・銀行API・ブロックチェーン接続。あくまでもデモとして入力フォームは作る。
- 実店舗向け QR 決済（別プロジェクトの領域。ここではオンライン決済に集中）

---

## 2. 技術スタック

既存の開発パターンに合わせる。

| レイヤ | 採用 |
|---|---|
| フロント（ウォレット / 加盟店ダッシュボード / Checkout ページ） | React + Vite + TypeScript、PWA、Cloudflare Pages |
| API | **Hono** on Cloudflare Workers（`wrangler dev` でローカル実行） |
| DB / 認証 | Supabase（Postgres + Supabase Auth）。台帳の書き込みは **Postgres RPC（plpgsql）** に集約しトランザクションを保証する |
| SDK | `packages/sdk` — 加盟店向け JS SDK（npm パッケージ形式、ローカル参照） |
| サンプルEC | React + Vite + Cloudflare Pages Functions（Webhook 受信用）×2 |
| テスト | Vitest（台帳・API）、Playwright（主要フローの E2E、P1） |
| 状態管理 / UI | TanStack Query、Tailwind CSS。UI ライブラリは軽量なもの1つに限定 |

無料枠で完結させる。有料サービスや追加 SaaS を入れる場合は先に確認を取ること。

### 2.1 リポジトリ構成（pnpm workspaces）

```
/
├── CLAUDE.md                 ← このファイル
├── apps/
│   ├── web/                  ← ユーザー向けウォレット PWA + 加盟店ダッシュボード + Checkout ページ
│   ├── api/                  ← Hono / Cloudflare Workers（内部API + 加盟店向け公開API + Webhook配信）
│   ├── shop-jp/              ← サンプル国内EC（JPY）
│   └── shop-global/          ← サンプル海外EC（USD、英語UI）
├── packages/
│   ├── sdk/                  ← 加盟店向け JS SDK（@payccount/js）
│   └── shared/               ← 型定義、通貨ユーティリティ、定数
├── supabase/
│   ├── migrations/           ← スキーマ・RPC・シード
│   └── seed.sql
├── docs/
│   ├── api.md                ← 公開API リファレンス（実装から生成 or 手書き）
│   ├── api.en.md             ← 同 英語版
│   ├── architecture.md
│   ├── deploy.md             ← デプロイ手順
│   └── specs/                ← 外部向け仕様書（加盟店 / チャージ用決済代行会社・金融機関 / 運営・管理者、日英）
└── .env.example
```

---

## 3. 通貨と金額の扱い（全レイヤ共通ルール）

- 金額は **最小単位の整数** で扱う（Stripe と同じ考え方）。DB は `NUMERIC(40,0)`、API/JSON では **文字列** で受け渡す（ETH の wei は JS の Number に収まらないため）。
- 通貨定義は `currencies` テーブルで管理する。

| code | kind | decimals | 備考 |
|---|---|---|---|
| JPY | fiat | 0 | 現地通貨・基軸 |
| USD | fiat | 2 | |
| EUR | fiat | 2 | |
| GBP | fiat | 2 | |
| BTC | crypto | 8 | 最小単位 satoshi |
| ETH | crypto | 18 | 最小単位 wei |
| PT  | points | 0 | 1 PT = 1 JPY 相当。出金不可、加盟店決済にのみ使用可 |

- `packages/shared` に `formatAmount(minor: string, code)` / `parseAmount(display: string, code)` を用意し、フロントは必ずこれを使う。浮動小数点で金額計算をしない（`bigint` または decimal ライブラリ）。
- レートは `NUMERIC(30,12)` で保存。両替計算は DB 側の RPC で行い、フロントは表示専用。

---

## 4. データモデル（Supabase / Postgres）

### 4.1 台帳（コア）

複式簿記。すべての残高変動は必ず仕訳（journal）を通す。残高テーブルを直接 UPDATE してはならない。

```sql
-- 勘定口座。ユーザー・加盟店・システムのそれぞれが通貨ごとに1口座持つ
accounts(
  id uuid pk,
  owner_type text check (owner_type in ('user','merchant','system')),
  owner_id uuid null,            -- system の場合 null
  system_code text null,         -- 'fx_pool','crypto_custody','points_issuer','fee_revenue','card_clearing','bank_clearing'
  currency text references currencies(code),
  balance numeric(40,0) not null default 0,   -- RPC 内でのみ更新（キャッシュ）
  unique(owner_type, owner_id, system_code, currency)
)

journal_entries(
  id uuid pk,
  type text,                     -- 'topup_card','topup_bank','points_purchase','fx_convert','crypto_buy','crypto_sell','payment','refund','payout','fee'
  idempotency_key text unique,   -- 冪等キー。同じキーで二重起票しない
  reference_type text, reference_id uuid,   -- payments.id など
  metadata jsonb,
  created_at timestamptz default now()
)

ledger_lines(
  id bigserial pk,
  journal_id uuid references journal_entries(id),
  account_id uuid references accounts(id),
  amount numeric(40,0) not null, -- 符号付き。借方+/貸方- ではなく単純に「その口座の増減」
  currency text not null
)
-- 不変条件: 同一 journal_id・同一 currency の amount 合計 = 0
-- 不変条件: owner_type in ('user','merchant') の accounts.balance >= 0
```

**RPC `post_journal(p_type, p_idempotency_key, p_lines jsonb, p_reference_type, p_reference_id, p_metadata)`**
- 1トランザクションで journal_entries / ledger_lines 挿入 + accounts.balance 更新
- 通貨ごとの合計が 0 でなければ例外
- user/merchant 口座が負になるなら `insufficient_funds` 例外
- 同じ idempotency_key が存在すれば既存の journal を返す（エラーにしない）

各業務処理（チャージ、両替、決済…）は **この RPC を呼ぶ専用 RPC**（例 `execute_payment`）として実装し、API 層からは1回の RPC 呼び出しで完結させる。

### 4.2 ユーザー / チャージ / ポイント

```sql
profiles(user_id pk → auth.users, display_name, country default 'JP', created_at)

topups(id, user_id, method 'card'|'bank_transfer', currency, amount, status 'pending'|'succeeded'|'failed', provider_ref, journal_id, created_at)

virtual_bank_accounts(id, user_id, bank_name, branch_code, account_number, holder_name, created_at)
bank_deposit_notifications(id, virtual_account_id, amount, payer_name, received_at, processed_at, topup_id)
  -- 模擬「入金通知」。ダッシュボードの「入金をシミュレート」ボタンで生成される

point_purchases(id, user_id, paid_currency 'JPY', paid_amount, points_granted, bonus_points, payment_method, status, journal_id, created_at)
point_campaigns(id, name, bonus_rate numeric(6,4), min_amount, active_from, active_to)
```

### 4.3 為替 / クリプト

```sql
rates(id, base text, quote text, rate numeric(30,12), source text, fetched_at)
  -- 例: base='USD', quote='JPY', rate=150.123456

fx_quotes(id, user_id, from_currency, to_currency, from_amount, to_amount, rate, spread_bps int, expires_at, status 'open'|'executed'|'expired', journal_id)

crypto_orders(id, user_id, side 'buy'|'sell', asset 'BTC'|'ETH', quote_currency 'JPY', asset_amount, quote_amount, price, spread_bps, status, journal_id, created_at)

crypto_withdrawals(id, user_id, asset, amount, to_address, fake_tx_hash, status, created_at)
  -- 模擬。実際には送金しない。fake_tx_hash はランダム生成
```

### 4.4 加盟店 / 決済 API

```sql
merchants(id, name, country 'JP'|'US'|..., settlement_currency, owner_user_id, website_url, created_at)

api_keys(id, merchant_id, prefix text, key_hash text, mode 'test', last_used_at, revoked_at, created_at)
  -- 平文キーは発行時に一度だけ返す。DB には SHA-256 ハッシュのみ

checkout_sessions(id 'cs_...', merchant_id, amount, currency, order_id, description, success_url, cancel_url,
  metadata jsonb, status 'open'|'completed'|'expired'|'canceled', expires_at, payment_id, created_at)

payments(id 'pay_...', merchant_id, session_id, payer_user_id,
  source_currency, source_amount,          -- ユーザーが払った通貨・額（JPY/PT/USD/BTC…）
  settlement_currency, settlement_amount,  -- 加盟店が受け取る通貨・額
  fx_rate numeric(30,12), fee_amount, fee_bps int,
  status 'succeeded'|'refunded'|'partially_refunded',
  refunded_amount default 0, journal_id, created_at)

refunds(id 're_...', payment_id, amount, reason, status, journal_id, created_at)

webhook_endpoints(id, merchant_id, url, secret, enabled, created_at)
webhook_events(id 'evt_...', merchant_id, type, payload jsonb, status 'pending'|'delivered'|'failed',
  attempts int, next_retry_at, last_status_code, last_response_body, created_at)

api_request_logs(id, merchant_id, method, path, status_code, duration_ms, created_at)
audit_logs(id, actor_type, actor_id, action, target_type, target_id, metadata, created_at)
```

RLS: ユーザーは自分の profiles / accounts / topups / quotes / orders のみ閲覧可。加盟店データはオーナーのみ。API（Workers）は service role で接続し、認可は API 層で行う。

---

## 5. API 仕様

API は 3 系統に分かれる。すべて JSON。

| 系統 | ベースパス | 認証 |
|---|---|---|
| A. ウォレット内部API（ユーザー） | `/me/*`, `/rates` | Supabase JWT（`Authorization: Bearer <jwt>`） |
| B. 加盟店向け公開API | `/v1/*` | APIキー（`Authorization: Bearer sk_test_xxx`） |
| C. モック用・管理API | `/mock/*`, `/admin/*` | 開発時のみ有効（環境変数 `DEMO_MOCK_ENDPOINTS=true`） |

### 5.1 共通ルール

- 金額は最小単位の **文字列**（`"amount": "1500"`, `"currency": "JPY"`）
- POST は `Idempotency-Key` ヘッダーを受け付ける（加盟店API では**必須**）。同一キー + 同一ボディなら同じレスポンスを返す。同一キー + 異なるボディなら `409`
- ID は接頭辞付き（`cs_`, `pay_`, `re_`, `evt_`, `wh_`, `qt_`）
- 全レスポンスに `X-Demo-Mode: true`、`X-Request-Id`
- エラー形式:

```json
{
  "error": {
    "type": "invalid_request_error" | "authentication_error" | "insufficient_funds" | "not_found" | "rate_limited" | "api_error",
    "code": "insufficient_funds",
    "message": "JPY残高が不足しています",
    "param": "amount"
  }
}
```

- レート制限（簡易）: APIキーごとに 60 req/分。超過で `429`
- ページネーション: `?limit=20&starting_after=<id>`、レスポンスは `{ "data": [...], "has_more": true }`

### 5.2 A. ウォレット内部API

```
GET  /me                         プロフィール + 全通貨残高
GET  /me/wallets                 [{ currency, balance, kind }]
GET  /me/transactions?currency=&limit=&starting_after=
                                 統合取引履歴（journal ベース）

POST /me/topups/card             { amount, currency:"JPY", card:{ number, exp, cvc } }
                                 → テスト番号 4242424242424242 成功 / 4000000000000002 失敗 / それ以外 400
POST /me/topups/bank/virtual-account
                                 → ユーザー専用の模擬振込先を発行（既存なら返す）
GET  /me/topups                  チャージ履歴

POST /me/points/purchase         { amount_jpy, method:"card"|"bank_transfer"|"wallet_jpy", card?:{...} }
                                 → 適用キャンペーンのボーナスを含めて PT を付与
GET  /me/points/campaigns        有効なキャンペーン一覧

GET  /rates?base=USD&quote=JPY   現在レート（スプレッド前）
POST /me/fx/quotes               { from_currency, to_currency, from_amount }
                                 → { id:"qt_...", to_amount, rate, spread_bps, expires_at }（60秒固定）
POST /me/fx/quotes/:id/execute   → 仕訳を起票し両替を確定。期限切れなら 410
GET  /me/fx/quotes/:id

GET  /crypto/prices              { BTC:{ JPY:"..." }, ETH:{ JPY:"..." } }
POST /me/crypto/orders           { side:"buy"|"sell", asset:"BTC", quote_currency:"JPY", asset_amount | quote_amount }
GET  /me/crypto/orders
POST /me/crypto/withdrawals      { asset, amount, to_address } → fake_tx_hash を返す（模擬）
GET  /me/crypto/deposit-address  { asset } → 固定の模擬アドレス

GET  /me/checkout/sessions/:id   Checkout ページ用。加盟店名・金額・支払可能ソースと換算額を返す
POST /me/checkout/sessions/:id/confirm
                                 { source_currency:"JPY"|"PT"|"USD"|"BTC"|... }
                                 → payments を作成し、加盟店へ精算通貨で入金、Webhook をキュー
POST /me/checkout/sessions/:id/cancel
```

### 5.3 B. 加盟店向け公開API（Stripe 風）

```
POST /v1/checkout/sessions
  Idempotency-Key: <required>
  {
    "amount": "5980",
    "currency": "JPY",
    "order_id": "ORDER-1001",
    "description": "商品A ×1",
    "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://shop.example/cart",
    "accepted_sources": ["JPY","PT","USD","BTC","ETH"],   // 省略時は全部
    "metadata": { "customer_id": "c_123" }
  }
  → 201 {
    "id": "cs_...", "object": "checkout.session", "status": "open",
    "url": "https://{{app_domain}}/checkout/cs_...",
    "amount": "5980", "currency": "JPY", "expires_at": "...", ...
  }

GET  /v1/checkout/sessions/:id
POST /v1/checkout/sessions/:id/expire

GET  /v1/payments?limit=&starting_after=&status=
GET  /v1/payments/:id
POST /v1/payments/:id/refunds     { "amount": "1000", "reason": "requested_by_customer" }  // 部分返金可
GET  /v1/refunds/:id

GET  /v1/balance                  { "available": [{ "currency":"JPY", "amount":"123456" }], "pending": [...] }
GET  /v1/balance/transactions     加盟店側の入出金明細

GET  /v1/webhook_endpoints
POST /v1/webhook_endpoints        { "url": "...", "events": ["payment.succeeded", ...] } → secret は作成時のみ返す
DELETE /v1/webhook_endpoints/:id
GET  /v1/events?limit=            配信済みイベント一覧
POST /v1/events/:id/resend        再送
```

### 5.4 Webhook 配信

- イベント種別: `checkout.session.completed`, `checkout.session.expired`, `payment.succeeded`, `payment.refunded`, `payout.paid`（P1）
- ペイロード:

```json
{
  "id": "evt_...",
  "type": "payment.succeeded",
  "created": 1735689600,
  "demo": true,
  "data": { "object": { ...payment... } }
}
```

- 署名ヘッダー `X-payCcount-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + body))>`
- SDK に `verifyWebhookSignature(body, header, secret, toleranceSec=300)` を用意
- 配信は Workers の Queue または Cron（無料枠に収まる方）で非同期。失敗時は指数バックオフで最大 5 回（1分, 5分, 30分, 2時間, 12時間）
- 加盟店ダッシュボードから手動再送可能。レスポンスコードと本文の先頭 1KB を保存

### 5.5 C. モック / 管理（開発時のみ）

```
POST /mock/bank/deposit           { virtual_account_id | account_number, amount, payer_name }
                                  → bank_deposit_notifications を生成し、入金通知処理（topup 完了→仕訳）を走らせる
POST /mock/rates/refresh          外部レート取得（フラグON時）またはシード再投入
POST /mock/rates/set              { base, quote, rate }  デモ中に為替を動かす
POST /mock/crypto/set-price       { asset, quote, price }
POST /admin/point-campaigns       キャンペーン作成
POST /admin/merchants             加盟店作成 + 初回APIキー発行
```

「入金通知 → 残高反映」は **銀行振込決済の実務と同じ流れ** で組む（通知受信 → 金額・振込先照合 → 冪等チェック → 仕訳 → ユーザー通知）。ここはこのプロジェクトの見せ場の1つなので手を抜かない。

---

## 6. 業務ロジック詳細

### 6.1 手数料・スプレッド（すべて設定値、`config` テーブル or 環境変数）

| 項目 | デフォルト |
|---|---|
| 加盟店決済手数料 | 1.6%（`fee_revenue` 勘定へ） |
| 為替スプレッド | 0.5%（`fx_pool` 勘定へ） |
| クリプト売買スプレッド | 1.0%（`crypto_custody` 勘定へ） |
| ポイント購入ボーナス | キャンペーンで指定（例 +1%）。ボーナス分は `points_issuer` 勘定から発行 |
| Checkout Session 有効期限 | 30 分 |
| FX Quote 有効期限 | 60 秒 |

### 6.2 決済（Checkout）のフロー

1. 加盟店が `POST /v1/checkout/sessions` → `url` を受け取りユーザーをリダイレクト
2. ユーザーが `/checkout/cs_xxx` を開く。未ログインならログイン後に戻る
3. 画面に加盟店名・金額（加盟店通貨）・**支払ソースごとの換算額**（JPY / PT / USD / BTC…）を表示。残高不足のソースは非活性
4. ユーザーが支払ソースを選び「支払う」→ `POST /me/checkout/sessions/:id/confirm`
5. サーバー側 RPC `execute_payment` が1トランザクションで:
   - ユーザー口座（source_currency）を減算
   - 異通貨なら `fx_pool` を経由して精算通貨に換算（スプレッド込み）
   - 加盟店口座（settlement_currency）に `settlement_amount - fee` を加算、`fee_revenue` に fee を加算
   - `payments` / `checkout_sessions.status='completed'` を更新
6. `payment.succeeded` と `checkout.session.completed` を Webhook キューへ
7. `success_url` の `{CHECKOUT_SESSION_ID}` を置換してリダイレクト

### 6.3 返金

- 加盟店残高（精算通貨）から減算 → ユーザーへ **元の支払ソース通貨** で返金。為替は返金時点のレートではなく **決済時の `fx_rate`** で戻す（差額は `fx_pool` が吸収）
- 手数料は返金しない（設定で切替可）
- 部分返金を複数回可。累計が元金額を超えたら `400`

### 6.4 ポイント

- 1 PT = 1 JPY。決済時のみ使用可能。両替・出金・クリプト購入には使えない
- 購入元は模擬カード／模擬銀行振込／JPY 残高
- ボーナス付与は `point_campaigns` の有効なものを適用（複数該当なら最大）
- 決済で PT を使う場合、加盟店には JPY で精算（`points_issuer` 勘定が JPY を負担する形で仕訳）

### 6.5 レート供給

- 起動時はシード（USD/JPY=150, EUR/JPY=162, GBP/JPY=190, BTC/JPY=15,000,000, ETH/JPY=500,000 など）
- 環境変数 `RATES_PROVIDER=mock|live`。`live` のときは無料API（為替: Frankfurter、クリプト: CoinGecko の無認証エンドポイント）から 5 分ごとに取得。取得失敗時は前回値を使う
- レートは常に `rates` テーブルを経由し、API から直接外部を叩かない

---

## 7. 画面一覧（apps/web）

### 7.1 ユーザー向け（PWA、モバイルファースト）
- `/login` — Supabase Auth（メールOTP。電話OTPは既存プロジェクト同様に切替可能な構成にしておく）
- `/` ホーム — 総資産（JPY換算）、通貨別残高カード、直近取引
- `/wallet/:currency` — 通貨別残高・履歴
- `/topup` — カードチャージ / 銀行振込先表示（＋開発モードでは「入金をシミュレート」ボタン）
- `/points` — ポイント購入、キャンペーン表示、残高
- `/exchange` — 両替（Quote → 確認 → 実行、残り秒数表示）
- `/crypto` — BTC/ETH 価格、購入・売却、入金アドレス、出金（模擬）
- `/checkout/:sessionId` — 加盟店決済ページ（§6.2）
- `/history` — 統合取引履歴（種別フィルタ）
- `/settings`

### 7.2 加盟店向け（`/merchant/*`、PC 向けレイアウト）
- `/merchant` — 売上サマリ、残高（精算通貨）、直近決済
- `/merchant/payments` — 決済一覧・詳細・返金
- `/merchant/developers` — APIキー発行・失効、Webhook エンドポイント登録、イベントログ・再送、リクエストログ
- `/merchant/docs` — 統合ガイド（`docs/api.md` をレンダリング）＋ SDK コードスニペット
- `/merchant/settings` — 店舗名、精算通貨、国


---

## 8. SDK（packages/sdk）

```ts
// 加盟店サーバー側
import { PayCcount } from '@payccount/js';
const wallet = new PayCcount('sk_test_...', { baseUrl: process.env.WALLET_API_URL });

const session = await wallet.checkout.sessions.create({
  amount: '5980', currency: 'JPY', order_id: 'ORDER-1001',
  success_url: '...', cancel_url: '...',
}, { idempotencyKey: 'ORDER-1001' });

// Webhook 検証
const event = wallet.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret);

// ブラウザ側（任意）
import { redirectToCheckout } from '@payccount/js/browser';
redirectToCheckout(session.id);
```

- `<script src="https://{{app_domain}}/sdk/pay.js" data-session="cs_..."></script>` で「payCcountで支払う」ボタンを描画する軽量スクリプトも提供
- 型定義を `packages/shared` から共有

---

## 9. サンプルEC

### 9.1 apps/shop-jp（国内EC）
- 日本語 UI、JPY 価格、商品 3〜5 点、カート、注文確定で SDK 経由の Checkout へ
- `functions/api/webhook.ts` で `payment.succeeded` を受け取り注文を「支払済」に更新（署名検証必須）
- 注文一覧ページで Webhook 受信状況が見える

### 9.2 apps/shop-global（海外EC）
- 英語 UI、USD 価格、精算通貨 USD の加盟店として登録
- 日本のユーザーが JPY / PT / BTC で払い、加盟店には USD で入るところを見せる（Checkout ページに換算額とレートを表示）

両方とも README に「加盟店登録 → APIキー設定 → 起動」の手順を書く。

---

## 10. 実装フェーズ（各フェーズ末に git commit、動作確認してから次へ）

### Phase 0 — 足場
- [x] pnpm workspaces、apps/api（Hono + wrangler）、apps/web（Vite + React + PWA）、packages/shared
- [x] Supabase プロジェクト接続、`.env.example`、`supabase/migrations/0001_init.sql`（currencies, accounts, journal_entries, ledger_lines, profiles）
- [x] `post_journal` RPC と Vitest（合計0チェック、負残高拒否、冪等キー）
- [x] デモバナー、`X-Demo-Mode` ヘッダー

### Phase 1 — JPY ウォレット
- [x] ログイン、ホーム、残高、取引履歴
- [x] 模擬カードチャージ（テスト番号）
- [x] 模擬銀行振込: 振込先発行 → `/mock/bank/deposit` → 入金通知処理 → 残高反映 → 画面通知

### Phase 2 — マルチカレンシー
- [x] currencies に USD/EUR/GBP、`rates` シード、`/rates`
- [x] Quote → Execute の両替フロー、期限切れ処理、スプレッド仕訳
- [x] ホームの総資産 JPY 換算

### Phase 3 — クリプト
- [x] BTC/ETH 価格、購入・売却（`crypto_custody` 勘定）
- [x] 模擬入金アドレス・模擬出金（fake tx hash）
- [x] `RATES_PROVIDER=live` 切替（任意）

### Phase 4 — ポイント
- [x] PT 通貨、購入（3 経路）、キャンペーン、ボーナス仕訳
- [x] 履歴・残高表示

### Phase 5 — 加盟店 API + Checkout
- [x] merchants / api_keys、`/admin/merchants`、キー認証ミドルウェア、冪等性ミドルウェア、レート制限
- [x] `/v1/checkout/sessions`、Checkout ページ、`execute_payment` RPC（異通貨・PT 対応）
- [x] `/v1/payments`、返金、`/v1/balance`
- [x] Webhook: エンドポイント登録、署名、非同期配信、リトライ、再送
- [x] 加盟店ダッシュボード一式

### Phase 6 — SDK + サンプルEC
- [x] packages/sdk（サーバー / ブラウザ / webhooks）
- [x] shop-jp、shop-global、それぞれ Webhook 受信まで通す
- [x] `docs/api.md`

### Phase 7 — 仕上げ
- [x] E2E（Playwright）: チャージ → 両替 → 海外ECで BTC 払い → 返金（`pnpm e2e`、サーバー自動起動）
- [x] 台帳整合性チェックのスクリプト（`pnpm ledger:verify`）
- [x] README（構想説明 + スクリーンショット + アーキテクチャ図）、Cloudflare Pages / Workers デプロイ手順、`docs/architecture.md`
- [x] `payCcount` の一括置換（全レイヤで `payCcount` 表記に統一済み。置換対象なし）
- [x] 管理者画面 `/admin/*`（§15: kuro が全ユーザー・加盟店・決済・台帳・Webhook・監査ログを閲覧）

---

## 11. 受け入れ基準（完了の定義）

- [x] 6 機能すべてが UI から操作できる（Playwright スモーク / E2E で確認）
- [x] 任意の操作列の後で `pnpm ledger:verify` が通る（全仕訳合計 0、user/merchant 口座 ≥ 0、accounts.balance と ledger_lines 集計が一致）— API テスト全件 + E2E 後に OK
- [x] 同一 `Idempotency-Key` で `POST /v1/checkout/sessions` を 2 回叩いても Session は 1 つ（`merchant.test.ts`、再送は `Idempotency-Replayed: true`）
- [x] shop-global で BTC 払い → 加盟店残高が USD で増え、`fee_revenue` と `fx_pool` / `crypto_custody` に差額が計上される（E2E: $49.99 → 残高 $49.20、fee_revenue $0.79、crypto_custody −$49.99 / +0.00050495 BTC）
- [x] 返金後、ユーザーの元通貨残高が決済時レートで戻る（$10 → 10,101 sat、全額返金で元の BTC 額に一致）
- [x] Webhook 配信先を落とした状態で決済 → 復旧後リトライで届く／ダッシュボードから再送できる（`merchant.test.ts` の「Webhook の信頼性」、ダッシュボードの再送・今すぐ配信）
- [x] デモ表示は TOP ページ最下部のみ（オーナー指示で全画面の上部帯は廃止）、全 API レスポンスに `X-Demo-Mode: true`

---

## 12. Claude Code への作業ルール

- フェーズ順に進める。フェーズをまたぐ先行実装はしない
- **残高を直接 UPDATE するコードを書かない**。すべて RPC 経由
- 金額計算に `number` を使わない（`bigint` / decimal）
- 本物の外部決済・ブロックチェーン・有料サービスを組み込まない。必要に見えたらモックにして `// TODO(real):` を残す
- 各フェーズ完了時に: テスト実行 → `git commit -m "phase N: ..."` → このファイル末尾の「進捗ログ」に日付と要点を追記
- 判断に迷う点は **デフォルトを選んで進め**、「決定事項」セクションに理由付きで記録する。ブロッキングな確認（有料サービス、外部アカウントが必要、仕様の矛盾）だけ質問する
- コードコメント・UI 文言は日本語、識別子・コミットメッセージは英語

---

## 13. 決定事項ログ

| 日付 | 決定 | 理由 |
|---|---|---|
| (初期) | 金額は最小単位の文字列 | ETH の wei が Number に収まらないため |
| (初期) | API は Hono / Workers、台帳は Postgres RPC | フロントは既存パターン、整合性は DB トランザクションに寄せる |
| 2026-09-11 | API の DB アクセスを「RPC 呼び出しのみ」の `Db` ポートに限定し、Supabase（PostgREST）アダプタとローカル Postgres（postgres.js）アダプタの 2 実装を持つ | 開発環境に Supabase プロジェクトが無くても `pnpm db:start` だけで全機能を動かし、Vitest で台帳・API を実 DB に対して検証できる。本番は Supabase をそのまま使う |
| 2026-09-11 | 認証は `AUTH_MODE=supabase`（Supabase Auth JWT）と `AUTH_MODE=demo`（メールだけでログインできるデモ認証、HS256 JWT）を切替可能にする | ローカル Postgres では GoTrue が無いため。フロントも `VITE_SUPABASE_URL` の有無で自動切替 |
| 2026-09-11 | 管理者アカウント（ID `kuro`）は固定 UUID で seed し、`profiles.role='admin'`。Supabase では `kuro@payccount.demo` + パスワード、ローカルでは `admin_credentials`（bcrypt）で ID/パスワード認証 | 仕様 §15。`/admin/*` は「開発時フラグ」ではなく管理者ロールの JWT で保護する（デモ運営者が本番相当でも使える） |
| 2026-09-11 | `journal_entries.reference_id` は `uuid` ではなく `text` | `payments.id` が `pay_...` 形式の text のため |
| 2026-09-11 | 業務エラーは plpgsql で `raise exception using message=<code>, detail=<日本語メッセージ>, hint=<param>`（errcode P0001）とし、API 層でコード→HTTP を変換する | PostgREST / postgres.js の両方で同じ構造のエラーが取れる。`insufficient_funds` は 402 |
| 2026-09-11 | `accounts` の一意制約は `unique nulls not distinct` | `owner_id` / `system_code` が NULL の口座で重複を防ぐため（PG15+、Supabase は対応） |
| 2026-09-11 | RPC の引数はスカラー / `jsonb` / `text[]` のみ（`uuid[]` などは使わない） | PostgREST と postgres.js の両方で型推論が安定する。`text[]` は RPC 内で cast する |
| 2026-09-11 | Workers では postgres.js の接続をリクエストごとに生成して閉じる（Supabase アダプタは共有） | Workers は TCP ソケットをリクエスト間で共有できない（"Cannot perform I/O on behalf of a different request"） |
| 2026-09-11 | `packages/shared` / `packages/sdk` は `exports` で `src/*.ts` を直接公開する（ビルド不要の内部パッケージ）。SDK は npm 公開用に `dist` ビルドも持つ | Vite / wrangler / vitest / tsc(bundler) はすべて TS ソースを解決でき、開発時のビルド手順を無くせる |
| 2026-09-11 | Vite は 7.x に固定（8 は plugin-react 5 系との組み合わせを避ける）、Vitest 4.x、Tailwind 4.x（`@tailwindcss/vite`） | 安定版の組み合わせ |
| 2026-09-11 | Checkout Session の `currency` は加盟店の精算通貨と一致必須（異なれば 400 `currency_not_supported`） | 決済ごとの為替を「支払ソース → 精算通貨」の 1 段に限定し、`payments.fx_rate` を 1 つのレートとして定義できる |
| 2026-09-11 | 返金は精算通貨の返金額を元の支払額で按分（`floor(source_amount × amount / settlement_amount)`、最後の全額返金は残り全部）。手数料は返さない（`config.refund_returns_fee` で切替） | 全額返金でユーザーの元通貨残高が厳密に元に戻る。為替差はプール勘定が吸収（仕様 §6.3） |
| 2026-09-11 | Webhook は `webhook_events`（加盟店単位）と `webhook_deliveries`（エンドポイント単位）に分離。再送は新しい配信レコードを作る | 複数エンドポイント・履歴保持・`skip locked` による多重実行耐性のため。仕様の `webhook_events.status/attempts` は配信レコード側に持つ |
| 2026-09-11 | `/v1` の冪等性は `idempotency_keys`（レスポンス保存）+ `checkout_sessions(merchant_id, idempotency_key)` 一意制約の二重防御 | 同時リクエストでも Session が 1 つになる |
| 2026-09-11 | レート制限は DB カウンタ（`api_rate_limits`、固定ウィンドウ 1 分） | Workers はアイソレート間でメモリを共有しないため |
| 2026-09-11 | `/admin/*` は `DEMO_MOCK_ENDPOINTS` ではなく管理者ロールの JWT で保護。`/mock/*` だけをフラグで切替 | 管理者アカウント（§15）が本番相当でも使える。モックは開発時のみ |
| 2026-09-11 | Webhook 配信は決済直後に `executionCtx.waitUntil`（テストではレスポンス前に await）+ Cron の再送 | ユーザーの応答を待たせずに配信し、失敗は Cron が拾う。テストでは決定的に検証できる |
| 2026-09-11 | サンプルEC は注文本体・状態・Webhook ログを別キーに保存 | `payment.succeeded` と `checkout.session.completed` が同時に届いたときの read-modify-write の更新消失を防ぐ（E2E で再現して修正） |
| 2026-09-11 | SDK 内では `fetch` を必ずラップして呼ぶ | Workers で別 `this` から `fetch` を呼ぶと "Illegal invocation" になる |
| 2026-09-11 | ローカル Postgres では `wrangler dev` から `DATABASE_URL` へ直接接続（postgres.js、リクエストごとに接続）。本番は Supabase（PostgREST） | デモを Supabase なしで完結させつつ、本番構成は仕様どおり |
| 2026-09-11 | 全 RPC の `set search_path = public, extensions`、seed も `set_config('search_path', 'public, extensions')` | Supabase では pgcrypto（`gen_random_bytes` / `digest` / `crypt`）が `extensions` スキーマにあるため。ローカル Postgres では存在しないスキーマは無視される |
| 2026-09-11 | デプロイは `scripts/deploy/deploy.sh`（Supabase Management API でマイグレーション適用、wrangler で Workers / Pages）に集約。認証情報は環境変数のみ、適用済みマイグレーションは `payccount_meta.migrations` に記録 | 再実行可能で、Claude Code の新しいセッションからも同じ手順で代行できる（`docs/deploy.md`）。Supabase Auth の OTP はテンプレートに `{{ .Token }}` を入れて 6 桁コードを送る（無料枠 + 既定メール送信ではテンプレート変更不可のため、既定の Magic Link でログイン） |
| 2026-09-11 | JWT 検証はトークンヘッダーの `alg` で分岐: HS256 は `JWT_SECRET`、それ以外は Supabase の JWKS | 新規 Supabase プロジェクトは anon / service_role が HS256（legacy）のまま、ユーザーのアクセストークンは ES256（JWT Signing Keys）で発行される。本番で 401 になったため修正 |
| 2026-09-11 | `0008_supabase_grants.sql`: `service_role` に public の全テーブル・シーケンス・関数を GRANT（anon / authenticated には付与しない） | Supabase の新規プロジェクトでは `postgres` が作るテーブルの既定権限が service_role に SELECT 等を含まず、`security definer` でないヘルパー（`get_rate_json` など）を PostgREST から呼ぶと permission denied になった。ブラウザは PostgREST を直接使わないため anon には開けない |
| 2026-09-12 | UI の日英対応は自前の軽量 i18n（`apps/web/src/i18n`）: `useI18n().t(key, params)`、辞書は名前空間別（`common` / `u.` / `m.` / `a.`）で日本語を先に定義し英語は同じキーを型で強制。言語は `?lang` → localStorage → ブラウザ言語。サーバー由来の日本語（取引の説明・通知）は英語では `metadata` / `data` から組み立て、API エラーは `code` で翻訳（`error.*`）。API ドキュメントは `docs/api.en.md` を別ファイルで保持 | ライブラリを足さずバンドルを小さく保ち、キーの欠落をコンパイル時に検出できる。サーバーの文言を変えずに英語化でき、日本語 UI は従来どおり |

## 14. 進捗ログ

（Claude Code がフェーズ完了ごとに追記）

- **2026-09-11 Phase 0 完了** — pnpm workspaces（apps/api, apps/web, packages/shared）、`supabase/migrations/0001_init.sql`（currencies / config / profiles / accounts / journal_entries / ledger_lines / notifications、`post_journal` / `ensure_account` / `ledger_verify` / `get_me` / `list_transactions` など）、`supabase/seed.sql`（管理者 kuro）。ローカル Postgres 用スクリプト `scripts/db/local.sh`（`pnpm db:start|reset|stop|psql`）と auth スタブ。API: Hono + `Db` ポート（Supabase / postgres.js）、デモ認証、`/me`、`/admin/ledger/verify`、`X-Demo-Mode` / `X-Request-Id`、Stripe 風エラー。Web: Vite + React 19 + Tailwind 4 + PWA、デモバナー、ログイン（ユーザー / 管理者タブ）、ホーム。テスト: shared 15 件、api 22 件（台帳の合計 0 / 負残高拒否 / 冪等キー / 同時実行 / ledger_verify、ヘッダー・エラー形式・認証）。`wrangler dev` + ローカル Postgres で疎通確認済み。
- **2026-09-11 Phase 1 完了** — `0002_wallet_jpy.sql`: topups / virtual_bank_accounts / bank_deposit_notifications、`topup_card`（テスト番号で成功・失敗、Idempotency-Key 対応）、`issue_virtual_bank_account`（7 桁口座番号）、`process_bank_deposit`（通知記録 → external_ref で冪等 → 振込先照合 → 金額検証 → topup + 仕訳 `topup_bank` → ユーザー通知。未照合は `unmatched` として記録し API は 404）。API: `/me/topups/card`、`/me/topups`、`/me/topups/bank/virtual-account`、`/me/topups/bank/deposits`、`/mock/bank/deposit`（`DEMO_MOCK_ENDPOINTS` で有効化）。Web: `/topup`（カード / 銀行振込タブ、入金シミュレート、入金通知履歴）、`/wallet/:currency`、`/history`（種別フィルタ・追加読み込み）、`/settings`、通知ベル（10 秒ポーリング）。テスト 34 件（api）+ Playwright でログイン → カードチャージ → 入金通知 → 履歴 → 通知 → 管理者ログインを画面で確認。
- **2026-09-11 Phase 2 完了** — `0003_multicurrency.sql`: USD/EUR/GBP 追加、`rates`（X/JPY で保存、`get_rate` が逆数・JPY 経由クロスを計算、PT は JPY 等価）、`set_rate` / `reseed_rates` / `list_rates`、`convert_minor`（切り捨て）/ `convert_minor_ceil`、`convert_to_jpy` をレート対応に置換、`fx_quotes`（`qt_` ID、実効レート = ミッド × (1 − spread)、60 秒）、`create_fx_quote` / `execute_fx_quote`（user from − / fx_pool from + / fx_pool to − / user to +、冪等、期限切れは `quote_expired` → 410）/ `expire_fx_quotes`。API: `GET /rates`（公開）、`/me/fx/quotes*`、`/mock/rates/set|refresh`、`/mock/maintenance/run`、Cron の `scheduled` で保守処理。Web: `/exchange`（Quote → 残り秒数 → 実行、レート一覧、両替履歴）、ホームの総資産が JPY 換算に。テスト 45 件（api）。Playwright で JPY 3,000 → USD 19.90 の両替と総資産 ¥4,985 を確認。
- **2026-09-11 Phase 3 完了** — `0004_crypto.sql`: BTC（8 桁）/ ETH（18 桁）追加とレートシード、`crypto_orders`（成行・即時約定、buy は mid × 1.01 / sell は mid × 0.99、`crypto_custody` 勘定と 4 行仕訳）、`crypto_deposit_addresses`（ユーザー × 資産で決定的な偽アドレス）、`crypto_deposits`（`process_crypto_deposit`、tx hash で冪等）、`crypto_withdrawals`（アドレス形式検証、fake tx hash、通知）。換算ヘルパーを `div()` ベースに書き換えて wei 精度の丸め誤差を排除（`convert_minor` / `_ceil` / `_div` / `_div_ceil`）。API: `GET /crypto/prices`（ミッド・買値・売値）、`/me/crypto/orders|deposit-address|deposits|withdrawals`、`/mock/crypto/set-price|deposit`。`RATES_PROVIDER=live`: Frankfurter（USD/EUR/GBP → JPY）+ CoinGecko（BTC/ETH → JPY）を Cron で 5 分ごとに取得し、失敗した通貨は前回値を維持（偽 fetch でテスト）。Web: `/crypto`（価格カード、購入 / 売却、入金アドレス + 入金シミュレート、出金、売買履歴）。テスト 59 件（api）。Playwright で BTC 購入 → 入金 → 出金 → 総資産 ¥164,900 を確認。
- **2026-09-11 Phase 4 完了** — `0005_points.sql`: PT 通貨、`point_campaigns`（シード: +1% / ¥10,000 以上 +3%、`pick_point_campaign` は最大ボーナスを選ぶ）、`point_purchases`、`purchase_points`（wallet_jpy: user JPY − / card: card_clearing − → points_issuer JPY +、points_issuer PT −granted / user PT +granted、ボーナスは points_issuer が無裏付けで発行、Idempotency-Key 対応、失敗カードは失敗履歴）、bank_transfer は識別コード `PTxxxxxxxx` を発行して pending にし、`process_bank_deposit` を拡張（`p_reference` または振込人名から抽出 → 金額一致で PT 付与、不一致なら通常チャージ + note）。`create_point_campaign` / `list_point_campaigns`。カード検証を `lib/cards.ts` に共通化。API: `/me/points/campaigns|purchase|purchases`、`/admin/point-campaigns`（GET/POST、管理者のみ）、`/mock/bank/deposit` に `reference`。Web: `/points`（残高、キャンペーン、購入フォーム 3 経路、保留中の振込 + 入金シミュレート、購入履歴）。テスト 73 件（api）。Playwright で JPY 残高購入 → 銀行振込購入 → 入金照合で 6,060 PT を確認。
- **2026-09-11 Phase 5 完了** — `0006_merchants.sql`: merchants / api_keys（SHA-256 ハッシュのみ保存、平文は発行時のみ）/ checkout_sessions（`cs_`、`(merchant_id, idempotency_key)` 一意、30 分）/ payments（`pay_`）/ refunds（`re_`）/ webhook_endpoints（`wh_`、`whsec_`）/ webhook_events（`evt_`）/ webhook_deliveries（`whd_`、エンドポイントごとの配信）/ idempotency_keys / api_rate_limits / api_request_logs / audit_logs。RPC: `authenticate_api_key`、`bump_rate_limit`（60 req/分・固定ウィンドウ）、`idempotency_lookup|store`、`create_checkout_session`（通貨は精算通貨と一致必須）、`get_checkout_view`（ソースごとの必要額 = `compute_source_amount`: 同通貨・PT→JPY はそのまま、異通貨はミッド × (1 − スプレッド) で切り上げ）、`execute_payment`（1 トランザクションで user source − → fx_pool / crypto_custody / points_issuer 経由 → merchant +net、fee_revenue +fee、`payment.succeeded` + `checkout.session.completed` をキュー、冪等）、`refund_payment`（元通貨で按分返金、最後は残り全額、手数料は返さない（config で切替）、累計超過は 400、加盟店残高不足は 402）、Webhook: `enqueue_webhook_event` / `claim_webhook_deliveries`（skip locked）/ `record_webhook_delivery`（1分,5分,30分,2時間,12時間・最大 5 回）/ `resend_webhook_event` / `expire_checkout_sessions`。API: `/v1/*`（APIキー認証 + POST は Idempotency-Key 必須、再送は `Idempotency-Replayed: true`、異なるボディは 409）、`/me/checkout/sessions/:id(/confirm|/cancel)`、`/me/merchants/*`（ダッシュボード用、オーナー/管理者）、`/admin/merchants`。Webhook 署名は `packages/shared/webhooks.ts`（`signWebhookPayload` / `verifyWebhookSignature`）で API と SDK が共有。配信は決済直後（`waitUntil`）+ Cron。Web: `/checkout/:sessionId`（ソース選択・換算額・残高不足は非活性・支払い → success_url へ）、`/merchant`（概要 / 決済と返金 / 開発者: APIキー・Webhook・イベントログ・再送・リクエストログ / ドキュメント / 設定 / 加盟店追加）。テスト 102 件（api）。Playwright で 加盟店登録 → キー発行 → Webhook 登録 → API で Session 作成 → Checkout 支払い → success_url リダイレクト → 署名付き Webhook 3 件受信 → 返金 を確認。
- **2026-09-11 Phase 6 完了** — `packages/sdk`（`@payccount/js`）: `PayCcount` クラス（`checkout.sessions.create|retrieve|expire`、`payments.list|retrieve|refund`、`refunds`、`balance`、`webhookEndpoints`、`events`、`webhooks.constructEvent`）、POST は Idempotency-Key 自動生成、`PayCcountError`、`@payccount/js/webhooks`（`constructEvent`）、`@payccount/js/browser`（`redirectToCheckout` / `renderPayButton`）、`tsc` で `dist` ビルド、テスト 6 件（偽 fetch）。Workers で `fetch` を別 this で呼ぶと Illegal invocation になるため必ずラップ。`apps/web/public/sdk/pay.js`（`data-session` でボタン描画）。`apps/shop-jp`（サクラ雑貨店・JPY・日本語）/ `apps/shop-global`（Globe Goods・USD・英語）: React + Vite + Pages Functions（`/api/checkout` がサーバー側でカタログから金額を再計算し SDK で Session 作成、`/api/webhook` が署名検証 + イベント ID 重複排除で注文を支払済/返金に更新、`/api/orders` で受信状況を表示、KV `ORDERS`（無ければメモリ））、`shop.config.ts` で言語・通貨・商品を切替、README に「加盟店登録 → APIキー設定 → 起動」。`docs/api.md` を実装に合わせて全面記述（`/merchant/docs` で描画）。Playwright で shop-jp を JPY 払い、shop-global を BTC 払い（$49.99 = 0.00050495 BTC）→ 両ショップとも Webhook で「支払済」に、Globe Goods の残高が USD 4,920、fee_revenue USD 79 / crypto_custody USD −4,999、$10 返金で 10,101 sat が戻ることを確認。
- **2026-09-11 Phase 7 完了** — 管理者画面 `/admin/*`（`0007_admin.sql`: `admin_overview` / `admin_list_users` / `admin_get_user` / `admin_list_journals`（口座の持ち主付き）/ `admin_list_accounts` / `admin_list_payments` / `admin_list_checkout_sessions` / `admin_list_webhook_deliveries` / `admin_list_audit_logs`。API `/admin/*` は管理者ロール必須、`/admin/maintenance/run` で Cron 相当を手動実行。Web: 概要（件数・システム勘定・台帳検証・レート・直近仕訳）/ ユーザー（検索・残高・詳細）/ 加盟店（一覧・作成）/ 決済・Session / 台帳（検証・仕訳ブラウザ・全口座）/ Webhook 配信 / キャンペーン / 監査ログ）。E2E（`e2e/`、`pnpm e2e`）: global-setup が API・ウォレット・shop-global を起動して加盟店を用意し、チャージ ¥30,000 → 両替 → BTC 購入 → shop-global で BTC 払い（0.00050495 BTC）→ Webhook で Paid → $10 返金で 10,101 sat 戻る → 台帳 OK の 6 テストが通過。`scripts/ledger-verify.ts`（`pnpm ledger:verify`）。README（構想・スクリーンショット 12 枚・mermaid 図・クイックスタート・Supabase / Cloudflare デプロイ手順）、`docs/architecture.md`（台帳の仕訳例・シーケンス図・ミドルウェア・Webhook・認証）。修正: ログイン後の遷移レース（管理者が `/` に飛ぶ）、管理者画面の白カードの文字色、サンプルEC の Webhook 同時受信での更新消失。最終: typecheck 全パッケージ OK、テスト shared 15 / sdk 6 / api 108 / e2e 6。
- **2026-09-11 デプロイ準備** — Supabase 互換修正（RPC の `search_path` に `extensions` を追加、seed も同様。ローカル `pnpm db:reset` + api テスト 108 件で確認）。`scripts/deploy/deploy.sh`（`check` / `supabase` / `api` / `web` / `shops` / `smoke` / `all`）: Management API でマイグレーションと seed を適用し Auth（Site URL・6 桁コード付きメール）を設定、`wrangler deploy` + `secret bulk`、ウォレットを `VITE_*` 付きでビルドして Pages へ、管理者ログインで加盟店 2 店（サクラ雑貨店 JPY / Globe Goods USD）を登録して APIキー・Webhook を発行し KV と secrets を用意してサンプル EC を Pages へ、最後に本番でチャージ → 決済 → Webhook → `ledger_verify` のスモーク。`docs/deploy.md` に認証情報の取得場所と Claude Code クラウド環境のネットワーク設定（Full または `api.cloudflare.com` / `api.supabase.com` / `*.supabase.co` / `*.workers.dev` / `*.pages.dev`）を記載。このセッションの環境は Trusted ネットワークで Cloudflare / Supabase に到達できず、実デプロイは環境設定の変更後に実行する。
- **2026-09-11 本番デプロイ完了** — 環境のネットワークを開放後に `deploy.sh` を実行。Supabase（`payCcount`、ap-northeast-1）に 0001〜0008 + seed を適用、Site URL / リダイレクト許可を設定（無料枠のためメールテンプレートは既定の Magic Link のまま）。Workers `payccount-api`（https://payccount-api.kuroatu0130.workers.dev、Cron 毎分）、Pages `payccount-web` / `payccount-shop-jp` / `payccount-shop-global`（KV `*-orders`）。本番で見つけて直した問題: (1) Supabase のアクセストークンが ES256 で API が 401 → `alg` で HS256 / JWKS を切替、(2) `get_rate_json` が permission denied → `0008_supabase_grants.sql`、(3) wrangler 4.131 の `pages project create` が新 Pages へ委譲して失敗 → REST API で作成、(4) `apps/web` に wrangler が無い → `apps/api` のバイナリを共用。本番スイープ: 管理者ログイン → カード ¥50,000 / 銀行振込 ¥3,000（`/mock/bank/deposit`）→ JPY 3,000 → USD 19.90 → BTC ¥10,000（66,006 sat）→ 3,030 PT → Globe Goods $29.99 を BTC 30,293 sat で支払い（加盟店 USD 29.52、fee $0.47）→ Webhook で Paid → $10 返金 → partially_refunded → 模擬出金 → `ledger_verify` OK（仕訳 10 件）。shop-jp も ¥1,200 を JPY 払いで Paid。
- **2026-09-11 UI 調整（オーナー指示）** — 上部の黄色いデモ帯を全画面から撤去し、デモ表示は TOP ページ最下部のフッターだけに（`DemoBanner` を削除、`DemoFooter` は Home のみ。Login / Settings / Checkout / 加盟店レイアウトのデモ文言も削除）。スマホ幅（390px）で管理者・加盟店画面を Playwright で撮影して修正: 概要の件数カードを 2 列グリッドに、金額は `whitespace-nowrap`（符号と数字の分離を防止）、システム勘定の code を別行に、表は `overflow-x-auto` + `whitespace-nowrap` でカード内横スクロール、グリッド子要素に `min-w-0`（ページ全体の横はみ出しを解消: ユーザー 201px / 加盟店 40px / 加盟店決済 137px → 0）、`Badge` / `Button` を nowrap、`Card` のアクションを `shrink-0`、管理者・加盟店ヘッダーをスマホで折り返さない構成（メールは sm 以上のみ、店舗切替は 2 行目に全幅）。全ページのスクリーンショットで横スクロールなしを確認し、本番 Pages へ再デプロイ。
- **2026-09-12 英語版（日英対応）** — `apps/web/src/i18n/`（`LocaleProvider` / `useI18n().t` / `LocaleSwitch`、辞書 `messages/{common,user,merchant,admin}.ts`、`labels.ts`）。ユーザー（ホーム・チャージ・両替・クリプト・ポイント・履歴・設定・通貨別）、加盟店（概要・決済・開発者・ドキュメント・登録・設定）、運営（概要・ユーザー・加盟店・決済・台帳・Webhook・キャンペーン・監査ログ）、ログイン、Checkout、404、権限案内、全レイアウトの文言を約 560 キーで日英化。言語は `?lang=ja|en` → localStorage → ブラウザ言語で決め、各ヘッダーの JA / EN で切替。サーバー由来の日本語は英語では `metadata` / `data` から組み立て（取引説明・通知）、API エラーは `code` → `error.*`、日付は言語別フォーマット、通貨名は `nameEn`。`docs/api.en.md`（英訳）を `/merchant/docs` で言語に応じて表示、SDK / `pay.js` のボタン文言も言語で切替。日本語 UI は文言を変えていない（辞書の `ja` は従来文字列そのまま、E2E は `locale: ja-JP`）。スマホ幅で日英全ページを撮影して確認し、typecheck 全パッケージ OK。
- **2026-09-12 外部向け仕様書（日英）** — `docs/specs/`: 加盟店向け決済接続仕様書（`merchant.ja.md` / `merchant.en.md`: 登録・APIキー・Checkout Session のシーケンスと状態・換算ルール・手数料 1.6%・返金の按分・Webhook 署名 `t,v1` の検証手順と再送 1分→5分→30分→2時間→12時間・冪等性・レート制限・SDK・テスト値・セキュリティ要件・制限事項）、チャージ接続仕様書（`provider.ja.md` / `provider.en.md`: 決済代行会社・金融機関向け。✅ 実装済み（モック）と 🧭 本番仕様を区別し、清算勘定 `card_clearing` / `bank_clearing` の仕訳、A カード決済（テスト番号・本番のオーソリ／売上／Webhook 案）、B 銀行振込（振込先発行・`/mock/bank/deposit` 入金通知の照合フロー・`processed|duplicate|unmatched|rejected`・識別コード `PTxxxxxxxx`）、C 銀行連携（口座連携の 🧭 シーケンスと要件）、精算・突合）、運営・管理者向け仕様書（`admin.ja.md` / `admin.en.md`: 役割・kuro の認証・`/admin/*` 画面と API・台帳モデルと不変条件・Cron 保守処理・`config` 既定値・レート供給・環境変数・Webhook 運用・キャンペーン・監査ログ・セキュリティ・デプロイ・障害対応 runbook）。`docs/specs/README.md` に索引、README からリンク。

## 15. 管理者アカウント
id:kuro
pass:atusi0130
上記で全てが閲覧出来る管理者権限を作成

- 実装: `supabase/seed.sql` で固定 UUID `00000000-0000-4000-8000-000000000001` の管理者を作成（`profiles.role = 'admin'`）。
  - Supabase Auth: メール `kuro@payccount.demo` / パスワード `atusi0130` でログイン（ログイン画面の「管理者」タブは ID `kuro` を自動でこのメールに変換する）
  - ローカル（`AUTH_MODE=demo`）: `admin_credentials` テーブル（bcrypt）で ID / パスワードを検証する `POST /auth/demo/admin-login`
  - 管理者は `/admin/*`（API・画面）で全ユーザー・加盟店・台帳・Webhook を閲覧できる
- **注意**: デモ用の固定値。デモ以外で使う場合は必ず変更すること。
