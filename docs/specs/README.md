# payCcount 仕様書 / Specifications

payCcount（デモ）を **外部の組織** に説明するための仕様書です。読者ごとに 3 冊に分かれ、それぞれ日本語版と英語版があります。実装の一次情報は [`docs/api.md`](../api.md)（API リファレンス）と [`docs/architecture.md`](../architecture.md)（内部設計）で、本ディレクトリの文書はそれらを読者別に再構成したものです。

These specifications describe payCcount (demo) to **external organizations**. There are three documents, one per audience, each in Japanese and English. The primary sources are [`docs/api.en.md`](../api.en.md) (API reference) and [`docs/architecture.md`](../architecture.md) (internal design, Japanese); the documents here rearrange that material per reader.

| 読者 / Audience | 日本語 | English | 内容 / Contents |
|---|---|---|---|
| 加盟店（EC サイト）/ Merchants (e-commerce sites) | [merchant.ja.md](merchant.ja.md) | [merchant.en.md](merchant.en.md) | 登録、API キー、Checkout Session、換算・手数料、返金、Webhook 署名と再送、SDK、テスト値、セキュリティ要件 / Onboarding, API keys, Checkout Sessions, conversion and fees, refunds, webhook signatures and retries, SDK, test values, security requirements |
| チャージ用決済代行会社・金融機関 / Payment service providers and banks (top-up) | [provider.ja.md](provider.ja.md) | [provider.en.md](provider.en.md) | 清算勘定と仕訳、A: カード決済、B: 銀行振込（振込先発行・入金通知・識別コード）、C: 銀行連携、精算・突合。✅ 実装済み（モック）と 🧭 本番仕様を区別 / Clearing accounts and journal entries; A: card payments, B: bank transfers (virtual accounts, deposit notifications, reference codes), C: bank account linking; settlement and reconciliation. ✅ implemented (mock) vs 🧭 production target |
| 運営・管理者 / Operators and administrators | [admin.ja.md](admin.ja.md) | [admin.en.md](admin.en.md) | 役割と認証、管理者画面と API、台帳モデルと不変条件、Cron 保守処理、設定値・レート・環境変数、Webhook 運用、キャンペーン、監査ログ、デプロイ、障害対応 / Roles and authentication, admin console and API, ledger model and invariants, cron maintenance jobs, configuration, rates, environment variables, webhook operations, campaigns, audit logs, deployment, incident runbook |

## 前提 / Assumptions

- すべて **デモ** の仕様です。実際の資金・カード情報・ブロックチェーンは扱いません。外部接続はモックで、文書中では「実装済み（モック）」と「本番で必要になる仕様」を区別して書いています。
- プレースホルダー `{{API_URL}}` / `{{APP_URL}}` は環境の URL に読み替えてください（公開デモ: `https://payccount-api.kuroatu0130.workers.dev` / `https://payccount-web.pages.dev`）。
- 日本語版と英語版は同じ構成・同じ節番号です。差分が生じた場合は日本語版を正とします。

- Everything here specifies a **demo**. No real funds, card data or blockchains are involved. External connections are mocked, and each document distinguishes "implemented (mock)" from "required in production".
- Replace the placeholders `{{API_URL}}` / `{{APP_URL}}` with your environment's URLs (public demo: `https://payccount-api.kuroatu0130.workers.dev` / `https://payccount-web.pages.dev`).
- The Japanese and English editions share the same structure and section numbers. Where they differ, the Japanese edition is authoritative.
