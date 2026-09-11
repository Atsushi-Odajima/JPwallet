# デプロイ手順（Supabase + Cloudflare Workers / Pages）

payCcount（デモ）を公開 URL で動かすための手順です。`scripts/deploy/deploy.sh` が全工程を自動化しており、認証情報は **環境変数** で渡します（チャットや git には残さない）。

## 構成

| 対象 | サービス | URL（既定のプロジェクト名） |
|---|---|---|
| DB / 認証 | Supabase（Postgres + Auth） | `https://<project-ref>.supabase.co` |
| API（`apps/api`） | Cloudflare Workers + Cron（毎分） | `https://payccount-api.<subdomain>.workers.dev` |
| ウォレット / 加盟店ダッシュボード / Checkout / 管理者（`apps/web`） | Cloudflare Pages | `https://payccount-web.pages.dev` |
| サンプル国内EC（`apps/shop-jp`） | Cloudflare Pages + Functions + KV | `https://payccount-shop-jp.pages.dev` |
| サンプル海外EC（`apps/shop-global`） | Cloudflare Pages + Functions + KV | `https://payccount-shop-global.pages.dev` |

すべて無料枠で動きます。

## 1. 必要な認証情報（8 つ）

| 環境変数 | 取得場所 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → テンプレート「Edit Cloudflare Workers」。Account Resources は自分のアカウント、Zone Resources は「All zones」。**Account / Cloudflare Pages / Edit** の行が無ければ追加。新形式は `cfut_…`、旧形式は 40 文字の英数字 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare ダッシュボード → Workers & Pages → 右側（スマホは下部）の Account ID。32 桁の 16 進数 |
| `SUPABASE_PROJECT_REF` | Supabase → Project Settings → General → Project ID（20 文字前後の英字） |
| `SUPABASE_URL` | Project Settings → Data API → Project URL（`https://xxxx.supabase.co`。末尾の `/rest/v1` は不要。付いていても自動で落とす） |
| `SUPABASE_ANON_KEY` | Project Settings → API Keys → Legacy anon, service_role → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | 同じ画面の `service_role`（Reveal） |
| `SUPABASE_JWT_SECRET` | Project Settings → JWT Keys → Legacy JWT Secret |
| `SUPABASE_ACCESS_TOKEN` | https://supabase.com/dashboard/account/tokens → Generate new token（`sbp_…`） |

任意: `WORKERS_SUBDOMAIN`（workers.dev のサブドメイン。未登録なら `payccount-demo` で登録）、`PAGES_WEB_PROJECT` / `PAGES_SHOP_JP_PROJECT` / `PAGES_SHOP_GLOBAL_PROJECT`（Pages プロジェクト名。名前が使用済みのときに変える）、`RATES_PROVIDER=mock|live`、`ADMIN_PASSWORD`。

## 2. Claude Code（クラウド）から実行する場合の環境設定

Claude Code のクラウドセッションは、既定の **Trusted** ネットワークでは Cloudflare / Supabase の API に到達できません。実行前に環境（Environment）を次のように設定します。

1. claude.ai/code のメッセージ入力欄の上にある **雲のアイコン（環境名）** をタップ → 使っている環境の **歯車（設定）**
2. **Network access** を **Full** にする。制限したい場合は **Custom** にして次を 1 行ずつ入れ、「default list of common package managers も含める」にチェック:
   ```
   api.cloudflare.com
   api.supabase.com
   *.supabase.co
   *.workers.dev
   *.pages.dev
   ```
3. **Environment variables** に上の 8 つを `.env` 形式（`KEY=value`）で貼る
4. 保存し、**新しいセッション** を開始する（設定は新しいセッションから反映される）

## 3. 実行

```bash
pnpm install
scripts/deploy/deploy.sh check      # 認証情報と到達性の確認だけ
scripts/deploy/deploy.sh all        # 全工程（10〜15 分）
```

個別に実行する場合は `supabase` → `api` → `web` → `shops` → `smoke` の順。何度実行しても安全です。

| サブコマンド | 内容 |
|---|---|
| `check` | 環境変数、到達性、Cloudflare トークン、Supabase プロジェクト、生成される URL を表示 |
| `supabase` | `supabase/migrations/*.sql` を未適用分だけ Management API で適用（適用状況は `payccount_meta.migrations` に記録。PostgREST には公開されない）。`seed.sql`（管理者 kuro）を適用。Auth の Site URL・リダイレクト許可・**6 桁コード付きメールテンプレート** を設定 |
| `api` | workers.dev サブドメインを確認（無ければ登録）→ `wrangler deploy`（`AUTH_MODE=supabase`、`APP_URL`、`ALLOWED_ORIGINS`、`DEMO_MOCK_ENDPOINTS=true`、`RATES_PROVIDER`）→ `wrangler secret bulk`（`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `JWT_SECRET`）→ `/health` 確認 |
| `web` | Pages プロジェクト作成 → `VITE_API_URL` / `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` を埋め込んでビルド → `wrangler pages deploy` |
| `shops` | 管理者でログインし、加盟店「サクラ雑貨店」（JPY）と「Globe Goods」（USD）を作成（既存なら再利用）→ **APIキーと Webhook シークレットを再発行** → KV namespace 作成 → `apps/shop-*/wrangler.toml` に KV ID と API URL を書き込み → Pages の secrets（`PAYCCOUNT_SECRET_KEY` / `PAYCCOUNT_WEBHOOK_SECRET` / `SHOP_URL`）→ ビルド → デプロイ |
| `smoke` | 管理者ログイン → `/me` → カードチャージ ¥5,000 → shop-jp で注文 → JPY で支払い → Webhook で「支払済」になるのを待つ → `ledger_verify` |

`shops` が `wrangler.toml` を更新したらコミットしてください（KV ID と URL のみ。秘密は含まれません）。

## 4. デプロイ後

- **ウォレット**: `https://<PAGES_WEB_PROJECT>.pages.dev`
  - ユーザー: メールアドレスを入力 → 届いた 6 桁コード（またはリンク）でログイン
  - 管理者: 「管理者」タブ → ID `kuro` / パスワード `atusi0130` → `/admin`。加盟店ダッシュボード（`/merchant`）にはサンプル EC 2 店が表示される（オーナーは管理者）
- **サンプルEC**: 商品をカートに入れて「payCcountで支払う」→ Checkout → 支払い → 注文一覧で Webhook 受信を確認
- **API**: `https://payccount-api.<subdomain>.workers.dev/health`。加盟店 API は `/v1/*`（`docs/api.md`）

### 注意点

- **ユーザーのログインはメールのリンク**: Supabase の無料枠 + 既定のメール送信ではメールテンプレートを変更できない（Management API が 400 を返す）ため、6 桁コードではなく既定の「Magic Link」メールが届きます。リンクをタップするとウォレットの `/login` に戻ってログインします。6 桁コードにしたい場合は Supabase → Authentication → SMTP Settings でカスタム SMTP（Resend など無料枠）を設定してから `deploy.sh supabase` を再実行してください（テンプレートに `{{ .Token }}` が入ります）
- **メール送信の上限**: Supabase 組み込みの SMTP は 1 時間あたり数通しか送れません。多人数にデモする場合もカスタム SMTP を設定してください。管理者ログインはパスワードなのでメール不要です
- **`/mock/*` が有効**（`DEMO_MOCK_ENDPOINTS=true`）: 「入金をシミュレート」「レート変更」などのデモ操作に必要ですが、認証なしで呼べます。デモ専用の設定です
- **認証情報のローテーション**: デモ終了後は Cloudflare API トークンと Supabase アクセストークンを Revoke してください。`shops` を再実行すると加盟店の APIキー / Webhook シークレットは新しくなります（古いキーは加盟店ダッシュボードから失効できます）
- **コード変更後の再デプロイ**: API は `deploy.sh api`、ウォレットは `deploy.sh web`、サンプル EC は `deploy.sh shops`（マイグレーションを追加したら先に `deploy.sh supabase`）
- **Auth 設定の自動更新に失敗した場合**: Supabase → Authentication → URL Configuration に Site URL（ウォレットの URL）とリダイレクト許可 `https://<ウォレット>/**` を、Email Templates の「Magic Link」「Confirm signup」に `{{ .Token }}` を含む本文を設定してください

## 5. 手動で行う場合（スクリプトを使わない）

1. Supabase の SQL エディタで `supabase/migrations/0001_init.sql` 〜 `0007_admin.sql` を順に実行し、続けて `supabase/seed.sql`
2. `cd apps/api && wrangler deploy --var AUTH_MODE:supabase --var APP_URL:https://<web> --var ALLOWED_ORIGINS:https://<web> --var DEMO_MOCK_ENDPOINTS:true --var RATES_PROVIDER:mock`、続けて `wrangler secret put SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `JWT_SECRET`
3. `cd apps/web && VITE_API_URL=https://<api> VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... pnpm build && wrangler pages deploy dist --project-name payccount-web --branch main`
4. ウォレットに管理者でログインして加盟店を作成し、APIキーと Webhook（`https://<shop>/api/webhook`）を発行。`wrangler kv namespace create ORDERS` の ID を `apps/shop-*/wrangler.toml` に書き、`wrangler pages secret put` で `PAYCCOUNT_SECRET_KEY` / `PAYCCOUNT_WEBHOOK_SECRET` / `SHOP_URL` を設定して `pnpm build && wrangler pages deploy`
