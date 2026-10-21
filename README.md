# payCcount — マルチカレンシー・ウォレットのデモ

法定通貨・暗号資産・ポイントの残高、両替、国内外のサンプルECでの支払いを一つの台帳で扱う、ウォレットのポートフォリオ実装です。

> **実装ブランチ：`claude/payccount-ewallet-implementation-4pka1n`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- JPY・USD・EUR・GBP、BTC・ETH、ポイントの残高と取引履歴
- 両替見積もり、チャージ・暗号資産入出金のシミュレーション
- 国内・海外EC、Checkout、加盟店向けAPI・SDK・Webhook、返金

## 現在の範囲・制限

- 外部決済・為替・ブロックチェーン接続はモックです。実資金・実暗号資産・実カード情報は扱いません。
- メール入力によるデモ認証とローカル用管理者設定を含みます。実サービスの認証・本人確認を実装済みとは扱いません。

## 実装の見どころ

**構成：** React / TypeScript / Vite、Cloudflare Workers（Hono）、PostgreSQL、pnpm ワークスペース。

- [apps/api/src/routes](https://github.com/Atsushi-Odajima/JPwallet/tree/claude%2Fpayccount-ewallet-implementation-4pka1n/apps/api/src/routes)
- [apps/web/src/pages](https://github.com/Atsushi-Odajima/JPwallet/tree/claude%2Fpayccount-ewallet-implementation-4pka1n/apps/web/src/pages)
- [packages/sdk](https://github.com/Atsushi-Odajima/JPwallet/tree/claude%2Fpayccount-ewallet-implementation-4pka1n/packages/sdk)
- [e2e](https://github.com/Atsushi-Odajima/JPwallet/tree/claude%2Fpayccount-ewallet-implementation-4pka1n/e2e)

## ローカルで試す

Node.js 20以上、pnpm 10、PostgreSQL 15以上と Bash（initdb / pg_ctl が必要）。WindowsのDBスクリプトはWSL等で実行します。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch claude/payccount-ewallet-implementation-4pka1n https://github.com/Atsushi-Odajima/JPwallet.git
cd JPwallet
pnpm install
pnpm db:start
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev
```

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/JPwallet/blob/claude%2Fpayccount-ewallet-implementation-4pka1n/README.md)。
WindowsでBash形式の補助スクリプトを使う場合は、WSL等の対応環境で実行してください。

## 検証方法

`リポジトリ直下` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
pnpm run typecheck
pnpm run test
pnpm run e2e
pnpm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [README.md](https://github.com/Atsushi-Odajima/JPwallet/blob/claude%2Fpayccount-ewallet-implementation-4pka1n/README.md)
- [画面資料](https://github.com/Atsushi-Odajima/JPwallet/tree/claude%2Fpayccount-ewallet-implementation-4pka1n/docs/screenshots)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
