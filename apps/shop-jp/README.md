# サクラ雑貨店 — サンプル国内EC（JPY）

payCcount（デモ）を決済手段として組み込んだサンプル EC です。React + Vite のフロントと、Cloudflare Pages Functions（`functions/`）で Checkout Session の作成と Webhook 受信を行います。

> これはデモです。実際の資金は移動しません。

## 構成

| パス | 役割 |
|---|---|
| `src/App.tsx` | 商品一覧・カート・注文確定（`POST /api/checkout` → payCcount の Checkout へリダイレクト）・注文一覧・サンクスページ |
| `functions/api/checkout.ts` | サーバー側でカタログから金額を再計算し、`@payccount/js` で Checkout Session を作成（冪等キー = 注文 ID） |
| `functions/api/webhook.ts` | `X-payCcount-Signature` を検証し、`payment.succeeded` で注文を「支払済」に更新。イベント ID で重複排除 |
| `functions/api/orders/*` | 注文一覧・詳細（Webhook 受信状況を含む） |
| `functions/_lib/store.ts` | 注文の保存（KV `ORDERS`。無ければメモリ） |
| `shop.config.ts` | 店名・通貨・商品・文言（shop-global はこのファイルが英語 / USD 版） |

## 手順（加盟店登録 → APIキー設定 → 起動）

前提: リポジトリルートで `pnpm install`、`pnpm db:start`、`pnpm dev`（API: http://localhost:8787、ウォレット: http://localhost:5173）が動いていること。

1. **加盟店登録**: ウォレット（http://localhost:5173）にログイン → 右上「加盟店ダッシュボード」→ 店舗名「サクラ雑貨店」、精算通貨 **JPY** で登録
2. **APIキー**: 開発者ページで「新しいキーを発行」→ 表示された `sk_test_…` をコピー
3. **Webhook**: 開発者ページで URL `http://localhost:5174/api/webhook` を追加 → 表示された `whsec_…` をコピー
4. `.dev.vars` を作成:
   ```
   cp .dev.vars.example .dev.vars
   # PAYCCOUNT_SECRET_KEY と PAYCCOUNT_WEBHOOK_SECRET を貼り付ける
   ```
5. 起動: `pnpm dev`（リポジトリルートなら `pnpm dev:shop-jp`）→ http://localhost:5174
6. 商品をカートに入れて「payCcountで支払う」→ payCcount の Checkout ページで JPY / ポイント / 外貨 / BTC を選んで支払う → サンクスページに戻り、数秒で「支払済」（Webhook 受信）になる
7. 加盟店ダッシュボード → 決済 で返金すると `payment.refunded` が届き、注文一覧の状態が変わる

## デプロイ（Cloudflare Pages）

```
wrangler kv namespace create ORDERS        # 出力された id を wrangler.toml に書く
pnpm build && wrangler pages deploy dist --project-name payccount-shop-jp
```

Pages の環境変数に `PAYCCOUNT_API_URL` / `PAYCCOUNT_SECRET_KEY` / `PAYCCOUNT_WEBHOOK_SECRET` / `SHOP_URL` を設定し、Webhook エンドポイントの URL を本番の `https://<pages>/api/webhook` に登録してください。
