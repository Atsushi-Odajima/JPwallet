# payCcount 運営・管理者向け仕様書

| 項目 | 内容 |
|---|---|
| 対象読者 | payCcount を運営する管理者（運営ダッシュボードの利用者・運用担当・保守担当） |
| 版 | 1.0（2026-09-12） |
| 前提 | payCcount は**デモアプリケーション**。管理者アカウントは固定値であり、デモ以外で使う場合は必ず変更する |
| 関連文書 | [加盟店向け仕様書](merchant.ja.md)、[チャージ接続仕様書](provider.ja.md)、[API リファレンス](../api.md)、[アーキテクチャ](../architecture.md)、[デプロイ手順](../deploy.md) |

---

## 1. 運営の役割

運営（システム）は、ユーザー・加盟店とは別に次の勘定と機能を持つ。

| 役割 | 内容 |
|---|---|
| 為替プール（`fx_pool`） | 両替・異通貨決済の相手勘定。スプレッド差益が残る |
| クリプト・カストディ（`crypto_custody`） | BTC / ETH の売買・入出金の相手勘定（模擬） |
| ポイント発行元（`points_issuer`） | PT の発行と、PT 決済時に加盟店へ JPY を精算する勘定 |
| 手数料収益（`fee_revenue`） | 加盟店決済手数料（1.6%）の受取 |
| カード清算 / 銀行清算（`card_clearing` / `bank_clearing`） | チャージ原資の未収金・預り金 |
| 監督 | 全ユーザー・加盟店・決済・台帳・Webhook 配信・監査ログの閲覧、加盟店とキャンペーンの作成、保守処理の手動実行 |

## 2. 管理者アカウントと認証

| 項目 | 仕様 |
|---|---|
| アカウント | ID `kuro`（固定 UUID `00000000-0000-4000-8000-000000000001`、`profiles.role = 'admin'`）。seed で作成 |
| 本番（Supabase Auth） | メール `kuro@payccount.demo` + パスワード。ログイン画面「管理者」タブは ID `kuro` を自動でこのメールに変換する |
| ローカル（デモ認証） | `admin_credentials`（bcrypt）で ID / パスワードを検証する `POST /auth/demo/admin-login` |
| 権限 | `/admin/*`（API・画面）は `role = 'admin'` の JWT のみ。ロールは `profiles` テーブルで管理し、API 層で判定する（開発フラグではない） |
| 管理者の一般機能 | 管理者もウォレット（残高・チャージ・決済）と加盟店ダッシュボードを使える。サンプル EC の加盟店はデモでは管理者がオーナー |
| 注意 | ID / パスワードはデモ用の固定値。デモ以外で使う場合は seed を変更し、Supabase 側でパスワードを更新する |

## 3. 運営ダッシュボード（`/admin/*`）

すべての画面は日本語 / 英語に対応し、スマホ幅でも閲覧できる（表はカード内で横スクロール）。

| 画面 | パス | 内容 |
|---|---|---|
| 概要 | `/admin` | 件数（ユーザー・加盟店・決済 / 返金・仕訳・未完了 Checkout・Webhook 待ち / 失敗）、台帳整合性（OK / NG、仕訳数・行数・検証時刻）、システム勘定残高、ユーザー残高 / 加盟店残高の通貨別合計、決済ボリューム（精算通貨別・手数料・返金）、レート一覧（値・出典）、直近の仕訳、**「Cron 相当の保守処理を実行」** |
| ユーザー | `/admin/users` | 検索（メール / 表示名）、一覧（ロール・残高・JPY 換算・店舗数 / 決済数）、詳細（プロフィール・模擬振込先・全通貨残高・所有加盟店・直近取引） |
| 加盟店 | `/admin/merchants` | 一覧（オーナー・精算通貨・手数料・残高・決済数・登録日）、**加盟店の作成 + 初回 APIキー発行**（キーは一度だけ表示） |
| 決済 | `/admin/payments` | 全加盟店の決済（支払者・支払通貨額・精算額・手数料・レートとスプレッド・状態）、Checkout Session 直近 100 件（状態・期限） |
| 台帳 | `/admin/ledger` | 整合性チェック（再チェック）、仕訳ブラウザ（種別で絞り込み、各行の持ち主・通貨・増減、参照 ID）、全口座一覧（種別・持ち主・通貨・残高） |
| Webhook | `/admin/webhooks` | 全加盟店の配信（状態で絞り込み、イベント・URL・試行回数・HTTP・次回・エラー）、**「期限が来た配信を今すぐ実行」** |
| キャンペーン | `/admin/campaigns` | ポイントキャンペーンの一覧（ボーナス率・最低金額・期間・実施中）と作成 |
| 監査ログ | `/admin/audit` | 加盟店作成・APIキー発行 / 失効・決済・返金・Checkout キャンセルの記録 |

## 4. 管理 API（`/admin/*`）

| メソッド / パス | 内容 |
|---|---|
| `GET /admin/overview` | 概要（§3 の集計） |
| `GET /admin/ledger/verify` | 台帳整合性チェック |
| `GET /admin/accounts` | 全口座 |
| `GET /admin/journals?limit=&starting_after=&type=` | 仕訳（行と持ち主付き） |
| `GET /admin/users?limit=&q=` / `GET /admin/users/:id` | ユーザー一覧 / 詳細 |
| `GET /admin/merchants` / `POST /admin/merchants` | 加盟店一覧 / 作成（`name`, `country`, `settlement_currency`, `website_url`, `owner_user_id` 省略時は管理者）+ 初回 APIキー |
| `GET /admin/payments` / `GET /admin/checkout-sessions` | 決済 / Session |
| `GET /admin/webhooks/deliveries?status=&limit=` | Webhook 配信 |
| `POST /admin/maintenance/run` | 保守処理を即時実行（§6） |
| `GET /admin/audit-logs` | 監査ログ |
| `GET /admin/point-campaigns` / `POST /admin/point-campaigns` | キャンペーン一覧（無効含む）/ 作成（`name`, `bonus_rate` 例 `"0.02"`, `min_amount`, `active_from?`, `active_to`） |

すべて管理者ロールの JWT が必要。管理者向け操作の一部（加盟店の APIキー・Webhook・返金）は加盟店ダッシュボード API（`/me/merchants/*`）を管理者権限で使う。

## 5. 台帳（複式簿記）

### 5.1 モデル

```
accounts(owner_type user|merchant|system, owner_id, system_code, currency, balance)
journal_entries(id, type, idempotency_key, reference_type, reference_id, metadata, created_at)
ledger_lines(journal_id, account_id, amount 符号付き, currency)
```

| 不変条件 | 内容 |
|---|---|
| 均衡 | 同一仕訳・同一通貨の `amount` 合計 = 0 |
| 非負 | `user` / `merchant` 口座の残高 ≥ 0（システム勘定は負を許容し「発行 / 預かり」を表す） |
| 一致 | `accounts.balance` = その口座の `ledger_lines` 合計 |
| 冪等 | `idempotency_key` が同じ仕訳は二重起票しない |
| 唯一の経路 | 残高の変更は RPC `post_journal` を通す業務 RPC のみ。API 層・画面は残高を直接更新しない |

### 5.2 仕訳の種類と相手勘定

| type | 内容 | 主な行 |
|---|---|---|
| `topup_card` | カードチャージ | ユーザー JPY + / `card_clearing` − |
| `topup_bank` | 銀行振込チャージ | ユーザー JPY + / `bank_clearing` − |
| `points_purchase` | ポイント購入 | 原資（ユーザー JPY / `card_clearing` / `bank_clearing`）− → `points_issuer` JPY +、`points_issuer` PT −（ボーナス込み）/ ユーザー PT + |
| `fx_convert` | 両替 | ユーザー from − / `fx_pool` from + / `fx_pool` to − / ユーザー to + |
| `crypto_buy` / `crypto_sell` | クリプト売買 | ユーザー JPY ∓ / `crypto_custody` JPY ± / `crypto_custody` 資産 ∓ / ユーザー資産 ± |
| `crypto_deposit` / `crypto_withdrawal` | 模擬入出金 | ユーザー資産 ± / `crypto_custody` 資産 ∓ |
| `payment` | 加盟店決済 | ユーザー source − → プール経由 → 加盟店 +net、`fee_revenue` +fee |
| `refund` | 返金 | 加盟店 − → プール経由（決済時レート）→ ユーザー source + |
| `adjustment` | 運営の調整（現在は画面からは起票しない） | 任意 |

### 5.3 整合性チェック

`GET /admin/ledger/verify`（画面「台帳」または `pnpm ledger:verify`）は次を返す。

```json
{ "ok": true, "journal_count": 10, "line_count": 32, "unbalanced_journals": [], "negative_accounts": [], "balance_mismatches": [], "checked_at": "…" }
```

`ok = false` のときは、`unbalanced_journals`（均衡しない仕訳）、`negative_accounts`（負残高のユーザー / 加盟店口座）、`balance_mismatches`（キャッシュと集計の不一致）に該当 ID が入る。RPC が正しく動いている限り発生しないため、発生時は直近のマイグレーションや手動 SQL を疑う。

## 6. 定期処理（Cron）

Workers の Cron（**毎分**）が `runMaintenance` を実行する。管理画面の「Cron 相当の保守処理を実行」と `POST /admin/maintenance/run` は同じ処理を即時に行う。

| 処理 | 内容 |
|---|---|
| FX Quote の期限切れ | 60 秒を過ぎた `open` な見積もりを `expired` に |
| Checkout Session の期限切れ | 30 分を過ぎた `open` な Session を `expired` にし、`checkout.session.expired` を発行 |
| 取り残し配信の再キュー | 5 分以上 `in_flight` の Webhook 配信を `pending` に戻す |
| Webhook 配信 | 期限が来た配信を最大 50 件処理（`skip locked` で多重実行に耐える）。失敗は 1 分 → 5 分 → 30 分 → 2 時間 → 12 時間、最大 5 回で `failed` |
| レート更新 | `RATES_PROVIDER=live` のとき 5 分ごとに Frankfurter（USD / EUR / GBP → JPY）と CoinGecko（BTC / ETH → JPY）から取得。失敗した通貨は前回値を維持 |

戻り値: `expired_fx_quotes`, `expired_checkout_sessions`, `requeued_stale_deliveries`, `webhooks { claimed, delivered, failed }`, `rates_refreshed`, `rate_errors[]`。

## 7. 運営パラメータ

### 7.1 `config` テーブル

| key | 既定値 | 内容 |
|---|---|---|
| `merchant_fee_bps` | `160` | 加盟店決済手数料（1.6%） |
| `fx_spread_bps` | `50` | 為替スプレッド（0.5%） |
| `crypto_spread_bps` | `100` | クリプト売買スプレッド（1.0%） |
| `checkout_session_ttl_minutes` | `30` | Checkout Session の有効期限 |
| `fx_quote_ttl_seconds` | `60` | 両替見積もりの有効期限 |
| `refund_returns_fee` | `false` | 返金時に決済手数料も戻すか |

変更は SQL（`update config set value = … where key = …`）で行う。管理画面からの編集は未提供。手数料の変更は**以後の決済**にのみ反映される（既存の Payment は `fee_bps` を保持）。

### 7.2 レート

| 項目 | 内容 |
|---|---|
| 保存 | `rates(base, quote='JPY', rate numeric(30,12), source, fetched_at)`。X/JPY で保存し、逆数・JPY 経由クロスは RPC が計算 |
| シード | USD 150、EUR 162、GBP 190、BTC 15,000,000、ETH 500,000（`source = seed`） |
| `RATES_PROVIDER` | `mock`（既定。固定値）/ `live`（5 分ごとに外部取得） |
| デモ中の変更 | `POST /mock/rates/set { base, quote, rate }`、`POST /mock/crypto/set-price { asset, price }`、`POST /mock/rates/refresh`（live なら再取得、mock ならシードに戻す）。`DEMO_MOCK_ENDPOINTS=true` のときのみ |

### 7.3 環境変数（API）

| 変数 | 内容 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 本番 DB（PostgREST、service role）。ローカルは `DATABASE_URL` |
| `AUTH_MODE` | `supabase`（本番）/ `demo`（ローカル。メールだけでログイン） |
| `JWT_SECRET` | HS256 の検証鍵（Supabase の legacy JWT secret / デモ認証）。ES256 のトークンは Supabase の JWKS で検証 |
| `APP_URL` | ウォレットの URL（Checkout の `url` に使う） |
| `ALLOWED_ORIGINS` | CORS 許可オリジン（カンマ区切り） |
| `DEMO_MOCK_ENDPOINTS` | `true` で `/mock/*` を有効化（**無認証**。本番相当では `false`） |
| `RATES_PROVIDER` | `mock` / `live` |

## 8. Webhook 運用

| 状態 | 意味 | 対応 |
|---|---|---|
| `pending` | 再試行待ち（`next_retry_at`） | 待つか「今すぐ実行」 |
| `in_flight` | 送信中 | 5 分超なら自動再キュー |
| `delivered` | 2xx 受領 | — |
| `failed` | 5 回失敗 | 加盟店の受信先を確認。加盟店ダッシュボードまたは `POST /v1/events/:id/resend` で再送（新しい配信レコード） |

配信ごとに応答コードと本文の先頭 1KB、エラー文字列を保存する。加盟店が受信先を落としている間の決済は失敗として蓄積され、復旧後の再送で届く。

## 9. キャンペーン運用

| 項目 | 内容 |
|---|---|
| 内容 | ポイント購入時のボーナス率（`bonus_rate`、例 `0.02` = +2%）、最低購入額（`min_amount`、円）、期間（`active_from` 〜 `active_to`） |
| 適用 | 購入時点で有効なキャンペーンのうち**ボーナス率が最大**のもの 1 つ |
| 仕訳 | ボーナス分は `points_issuer` が無裏付けで発行する（`points_issuer` PT 残高が負になる = 発行済みポイント） |
| シード | 「デモ開始キャンペーン +1%（¥1,000 以上）」「まとめ買い +3%（¥10,000 以上）」 |
| 作成 | 管理画面「キャンペーン」または `POST /admin/point-campaigns` |

## 10. 監査ログと通知

### 10.1 監査ログ（`audit_logs`）

| action | 記録タイミング | actor / target |
|---|---|---|
| `merchant.create` | 加盟店作成 | user → merchant |
| `api_key.create` / `api_key.revoke` | APIキー発行 / 失効 | user → api_key |
| `payment.succeeded` | 決済確定 | user → payment（金額・通貨） |
| `payment.refund` | 返金 | user（加盟店オーナー）→ refund（金額・payment_id） |
| `checkout.cancel` | お客様による Checkout キャンセル | user → checkout_session |

加えて、加盟店 API の全リクエストは `api_request_logs`（メソッド・パス・状態・所要時間・Request-Id）に記録され、加盟店ダッシュボードで直近 50 件を確認できる。

### 10.2 ユーザー通知（`notifications`）

`topup_card` / `topup_bank` / `points_purchase` / `crypto_deposit` / `crypto_withdrawal` / `payment` / `refund`。ウォレットのベルに表示され、既読管理される。

## 11. セキュリティ

| 項目 | 仕様 |
|---|---|
| DB アクセス | API は Supabase の service role で PostgREST の RPC のみを呼ぶ。テーブルへの直接アクセスはしない |
| RLS | 全テーブルで有効。ユーザーは自分の行だけ、加盟店データはオーナーのみ、`anon` / `authenticated` には API 実行権限・テーブル権限を付与しない |
| 認証 | ユーザー / 管理者は JWT（HS256 は `JWT_SECRET`、ES256 は JWKS）。加盟店は APIキー（ハッシュ照合）。管理者は `role` で判定 |
| 秘密情報 | APIキー・Webhook シークレットはハッシュまたは作成時のみ表示。カード番号・CVC は保存しない |
| レート制限 | 加盟店 API は DB カウンタで 60 req/分 |
| モック | `/mock/*` は無認証。本番相当では `DEMO_MOCK_ENDPOINTS=false` にする |
| 監査 | §10 |

## 12. デプロイと環境

| 対象 | サービス | 手順 |
|---|---|---|
| DB / 認証 | Supabase（Postgres + Auth） | `scripts/deploy/deploy.sh supabase`（マイグレーション・seed・Auth 設定） |
| API | Cloudflare Workers（Cron 毎分） | `deploy.sh api`（vars + secrets） |
| ウォレット / ダッシュボード / 管理画面 | Cloudflare Pages | `deploy.sh web` |
| サンプル EC | Cloudflare Pages + Functions + KV | `deploy.sh shops`（加盟店登録・キー / Webhook 発行を含む） |
| 動作確認 | — | `deploy.sh smoke`（ログイン → チャージ → 決済 → Webhook → 台帳検証） |

詳細と必要な認証情報は [deploy.md](../deploy.md)。ヘルスチェックは `GET {API_URL}/health`（`{ ok, auth_mode, time }`）。

## 13. 障害対応（runbook）

| 事象 | 確認 | 対応 |
|---|---|---|
| 台帳整合性 NG | 管理画面「台帳」の `unbalanced_journals` / `negative_accounts` / `balance_mismatches` | 該当仕訳を特定し、手動 SQL やマイグレーションの有無を確認。必要なら `adjustment` 仕訳で是正 |
| Webhook が届かない | 管理画面「Webhook」で状態・HTTP・エラー | 加盟店の受信先を確認。復旧後に「今すぐ実行」または再送 |
| レートが更新されない（live） | 概要のレート出典と `fetched_at` | `POST /mock/rates/refresh` で再取得。外部 API 障害時は前回値で継続 |
| 未照合入金（`unmatched`） | ユーザー詳細の入金通知履歴 | 振込先番号を確認し、正しい口座番号で通知を再送（`external_ref` を変える） |
| API が 5xx | `X-Request-Id` と Workers のログ | DB 到達性（Supabase）と secrets を確認 |
| 決済できない（`insufficient_funds`） | ユーザーの残高と換算必要額 | 仕様どおり。残高不足のソースは Checkout で非活性 |

## 14. 制限事項（デモ）

- 管理者は 1 名固定。権限の細分化（閲覧のみ・加盟店管理のみ等）はない。
- 手数料・スプレッド・TTL は SQL で変更する（画面なし）。
- 調整仕訳・チャージバック・組戻し・出金の運用機能はない。
- 外部接続（カード・銀行・ブロックチェーン）はすべてモック。レートも既定は固定値。
- バックアップ・監視・アラートは Supabase / Cloudflare の標準機能に依存する。

## 付録 改訂履歴

| 版 | 日付 | 内容 |
|---|---|---|
| 1.0 | 2026-09-12 | 初版（Phase 7 の管理者画面と運用機能に基づく） |
