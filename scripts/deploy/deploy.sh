#!/usr/bin/env bash
# ============================================================================
# payCcount デプロイスクリプト（Supabase + Cloudflare Workers / Pages）
#
#   scripts/deploy/deploy.sh check     … 認証情報と到達性の確認（何も変更しない）
#   scripts/deploy/deploy.sh supabase  … マイグレーション + seed の適用、Auth 設定（OTP メール・Site URL）
#   scripts/deploy/deploy.sh api       … apps/api を Workers にデプロイ（vars + secrets）
#   scripts/deploy/deploy.sh web       … apps/web をビルドして Pages にデプロイ
#   scripts/deploy/deploy.sh shops     … 加盟店 2 店を登録し、shop-jp / shop-global を Pages にデプロイ
#   scripts/deploy/deploy.sh smoke     … 本番に対する動作確認（管理者ログイン → チャージ → 決済 → Webhook → 台帳検証）
#   scripts/deploy/deploy.sh all       … 上記を順に実行
#
# 必要な環境変数（docs/deploy.md 参照。値はチャットや git に残さず、環境変数で渡す）:
#   CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
#   SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET SUPABASE_ACCESS_TOKEN
# 任意:
#   WORKERS_SUBDOMAIN          workers.dev のサブドメイン（未登録なら登録する。既定: payccount-demo）
#   PAGES_WEB_PROJECT          ウォレットの Pages プロジェクト名（既定: payccount-web）
#   PAGES_SHOP_JP_PROJECT      shop-jp の Pages プロジェクト名（既定: payccount-shop-jp）
#   PAGES_SHOP_GLOBAL_PROJECT  shop-global の Pages プロジェクト名（既定: payccount-shop-global）
#   RATES_PROVIDER             mock | live（既定: mock）
#   ADMIN_PASSWORD             管理者 kuro のパスワード（既定: atusi0130。shops / smoke で使う）
#
# 何度実行しても安全（冪等）に作ってある。加盟店の APIキーと Webhook シークレットは実行ごとに再発行する。
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CMD="${1:-all}"

WORKERS_SUBDOMAIN="${WORKERS_SUBDOMAIN:-payccount-demo}"
PAGES_WEB_PROJECT="${PAGES_WEB_PROJECT:-payccount-web}"
PAGES_SHOP_JP_PROJECT="${PAGES_SHOP_JP_PROJECT:-payccount-shop-jp}"
PAGES_SHOP_GLOBAL_PROJECT="${PAGES_SHOP_GLOBAL_PROJECT:-payccount-shop-global}"
RATES_PROVIDER="${RATES_PROVIDER:-mock}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-atusi0130}"
ADMIN_EMAIL="kuro@payccount.demo"

# wrangler: 対話プロンプトを出さない・テレメトリを送らない・Node の fetch もプロキシ環境変数を読む
export CI=true WRANGLER_SEND_METRICS=false NODE_USE_ENV_PROXY=1
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

WEB_URL="https://${PAGES_WEB_PROJECT}.pages.dev"
SHOP_JP_URL="https://${PAGES_SHOP_JP_PROJECT}.pages.dev"
SHOP_GLOBAL_URL="https://${PAGES_SHOP_GLOBAL_PROJECT}.pages.dev"
API_URL=""   # workers.dev サブドメインが分かった時点で決まる

TMPDIR_DEPLOY="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_DEPLOY"' EXIT

# ───────────────────────── ユーティリティ ─────────────────────────
log()  { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

need_env() {
  local missing=()
  for v in "$@"; do [ -n "${!v:-}" ] || missing+=("$v"); done
  [ ${#missing[@]} -eq 0 ] || die "環境変数が未設定です: ${missing[*]}（docs/deploy.md を参照）"
}
need_cmd() { for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "$c が必要です"; done; }

# SUPABASE_URL は https://xxxx.supabase.co まで（/rest/v1 などが付いていたら落とす）
normalize_env() {
  SUPABASE_URL="$(printf '%s' "${SUPABASE_URL:-}" | sed -E 's#/(rest|auth)/v1/?$##; s#/+$##')"
  export SUPABASE_URL
}

# Cloudflare API（JSON）。success=false なら失敗
cf_api() { # method path [json]
  local method=$1 path=$2 data=${3:-}
  local args=(-sS -X "$method" "https://api.cloudflare.com/client/v4$path" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json")
  [ -n "$data" ] && args+=(--data "$data")
  local out
  out="$(curl "${args[@]}")" || return 1
  if [ "$(printf '%s' "$out" | jq -r '.success // false')" != "true" ]; then
    printf '%s' "$out" | jq -c '.errors' >&2 || printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s' "$out"
}

# Supabase Management API。2xx 以外は失敗
sb_api() { # method path [json-file]
  local method=$1 path=$2 file=${3:-}
  local body="$TMPDIR_DEPLOY/sb_body.$$"
  local args=(-sS -o "$body" -w '%{http_code}' -X "$method" "https://api.supabase.com/v1$path" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json")
  [ -n "$file" ] && args+=(--data-binary "@$file")
  local code
  code="$(curl "${args[@]}")" || { cat "$body" >&2 2>/dev/null; return 1; }
  if [ "${code:0:1}" != "2" ]; then
    printf 'Supabase API %s %s -> HTTP %s\n' "$method" "$path" "$code" >&2
    cat "$body" >&2; echo >&2
    return 1
  fi
  cat "$body"
}

# SQL を実行（ファイル）。結果は最後の文の行が JSON 配列で返る
sb_query_file() {
  local sqlfile=$1 req="$TMPDIR_DEPLOY/query.json"
  jq -cn --rawfile q "$sqlfile" '{query:$q}' > "$req"
  sb_api POST "/projects/$SUPABASE_PROJECT_REF/database/query" "$req"
}
sb_query() { # sql 文字列
  printf '%s' "$1" > "$TMPDIR_DEPLOY/query.sql"
  sb_query_file "$TMPDIR_DEPLOY/query.sql"
}

wrangler_in() { # dir args...  （wrangler は apps/api の devDependency を全アプリで使う）
  local dir=$1; shift
  local bin="$ROOT/apps/api/node_modules/.bin/wrangler"
  if [ -x "$bin" ]; then
    (cd "$ROOT/$dir" && "$bin" "$@")
  else
    (cd "$ROOT/$dir" && pnpm exec wrangler "$@")
  fi
}

# 管理者（kuro）の Supabase Auth トークン
admin_token() {
  local res
  res="$(curl -sS -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
    --data "$(jq -cn --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" '{email:$e,password:$p}')")"
  local tok
  tok="$(printf '%s' "$res" | jq -r '.access_token // empty')"
  [ -n "$tok" ] || { printf '%s\n' "$res" >&2; die "管理者ログインに失敗しました（seed が適用されているか、ADMIN_PASSWORD を確認）"; }
  printf '%s' "$tok"
}

# payCcount API 呼び出し（Bearer）。2xx 以外は失敗
api() { # method path [json] （TOKEN 変数を使う）
  local method=$1 path=$2 data=${3:-}
  local body="$TMPDIR_DEPLOY/api_body.$$"
  local args=(-sS -o "$body" -w '%{http_code}' -X "$method" "$API_URL$path" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Idempotency-Key: deploy-$(date +%s%N)")
  [ -n "$data" ] && args+=(--data "$data")
  local code
  code="$(curl "${args[@]}")"
  if [ "${code:0:1}" != "2" ]; then
    printf 'API %s %s -> HTTP %s\n' "$method" "$path" "$code" >&2; cat "$body" >&2; echo >&2
    return 1
  fi
  cat "$body"
}

# ───────────────────────── Cloudflare の前提 ─────────────────────────
resolve_api_url() {
  [ -n "$API_URL" ] && return 0
  local sub
  sub="$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" 2>/dev/null | jq -r '.result.subdomain // empty' || true)"
  if [ -z "$sub" ]; then
    log "workers.dev サブドメインを登録: $WORKERS_SUBDOMAIN"
    cf_api PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" "$(jq -cn --arg s "$WORKERS_SUBDOMAIN" '{subdomain:$s}')" >/dev/null \
      || die "サブドメイン '$WORKERS_SUBDOMAIN' を登録できません（使用済みの可能性）。WORKERS_SUBDOMAIN を別名にして再実行してください"
    sub="$WORKERS_SUBDOMAIN"
  fi
  API_URL="https://payccount-api.${sub}.workers.dev"
  ok "API URL: $API_URL"
}

ensure_pages_project() { # name
  local name=$1
  if cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$name" >/dev/null 2>&1; then
    ok "Pages プロジェクト $name は存在"
  else
    # wrangler 4.13x の `pages project create` は新しい Pages（Workers 統合）へ委譲して失敗することがあるため REST API で作る（従来の pages.dev）
    log "Pages プロジェクトを作成: $name"
    cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects" "$(jq -cn --arg n "$name" '{name:$n, production_branch:"main"}')" >/dev/null \
      || die "Pages プロジェクト '$name' を作成できません（名前が使用済みなら PAGES_*_PROJECT で別名を指定）"
    ok "Pages プロジェクト $name を作成"
  fi
}

ensure_kv_namespace() { # title -> id
  local title=$1 id
  id="$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces?per_page=100" | jq -r --arg t "$title" '.result[] | select(.title==$t) | .id' | head -1)"
  if [ -z "$id" ]; then
    id="$(cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces" "$(jq -cn --arg t "$title" '{title:$t}')" | jq -r '.result.id')"
    ok "KV namespace を作成: $title ($id)" >&2
  else
    ok "KV namespace $title は存在 ($id)" >&2
  fi
  printf '%s' "$id"
}

# ───────────────────────── check ─────────────────────────
cmd_check() {
  need_cmd curl jq pnpm node
  need_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_ANON_KEY \
    SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET SUPABASE_ACCESS_TOKEN
  normalize_env

  log "到達性（このホストへ HTTPS で出られるか）"
  local blocked=() code h
  for h in api.cloudflare.com api.supabase.com "${SUPABASE_URL#https://}"; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$h/" 2>/dev/null)" || code=000
    if [ "$code" = "000" ]; then blocked+=("$h"); printf '  \033[31m✗\033[0m %s (接続不可)\n' "$h"; else ok "$h (HTTP $code)"; fi
  done
  # デプロイ後の確認に使うホスト（未デプロイでも Cloudflare が応答する。000 なら許可リスト漏れの可能性）
  for h in "${WORKERS_SUBDOMAIN}.workers.dev" "${PAGES_WEB_PROJECT}.pages.dev"; do
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "https://$h/" 2>/dev/null)" || code=000
    if [ "$code" = "000" ]; then warn "$h に接続できません（*.workers.dev / *.pages.dev の許可を確認）"; else ok "$h (HTTP $code)"; fi
  done
  if [ ${#blocked[@]} -gt 0 ]; then
    die "次のホストに到達できません: ${blocked[*]}
  Claude Code のクラウド環境なら、環境設定の Network access を Full にするか、Custom で
  api.cloudflare.com / api.supabase.com / *.supabase.co / *.workers.dev / *.pages.dev を許可してください"
  fi

  log "Cloudflare API トークン"
  cf_api GET /user/tokens/verify | jq -r '"  status=" + .result.status'
  cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID" | jq -r '"  account=" + .result.name'
  resolve_api_url

  log "Supabase プロジェクト"
  sb_api GET "/projects/$SUPABASE_PROJECT_REF" | jq -r '"  name=" + .name + " region=" + .region + " status=" + .status'

  log "計画"
  echo "  API     : $API_URL"
  echo "  ウォレット: $WEB_URL"
  echo "  shop-jp : $SHOP_JP_URL"
  echo "  shop-global: $SHOP_GLOBAL_URL"
}

# ───────────────────────── supabase ─────────────────────────
cmd_supabase() {
  need_cmd curl jq
  need_env SUPABASE_PROJECT_REF SUPABASE_URL SUPABASE_ACCESS_TOKEN
  normalize_env

  log "マイグレーション管理テーブル（payccount_meta.migrations — PostgREST には公開されない）"
  sb_query "create schema if not exists payccount_meta;
create table if not exists payccount_meta.migrations (name text primary key, applied_at timestamptz not null default now());" >/dev/null
  ok "payccount_meta.migrations"

  local applied
  applied="$(sb_query "select name from payccount_meta.migrations order by name" | jq -r '.[].name')"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    local name; name="$(basename "$f")"
    if printf '%s\n' "$applied" | grep -qx "$name"; then
      ok "$name（適用済み）"
      continue
    fi
    log "migrate $name"
    { cat "$f"; printf '\ninsert into payccount_meta.migrations(name) values (%s) on conflict do nothing;\n' "'$name'"; } > "$TMPDIR_DEPLOY/mig.sql"
    sb_query_file "$TMPDIR_DEPLOY/mig.sql" >/dev/null || die "$name の適用に失敗しました"
    ok "$name"
  done

  log "seed（管理者 kuro）"
  sb_query_file "$ROOT/supabase/seed.sql" >/dev/null || die "seed.sql の適用に失敗しました"
  ok "seed.sql"

  log "検証"
  sb_query "select (select count(*) from currencies) as currencies, (select count(*) from profiles where role = 'admin') as admins, ledger_verify() as ledger" | jq -c '.[0]'

  log "Auth 設定（Site URL / リダイレクト許可）"
  jq -cn --arg site "$WEB_URL" --arg allow "$WEB_URL/**,$WEB_URL/login,http://localhost:5173/**" \
    '{site_url: $site, uri_allow_list: $allow, external_email_enabled: true}' > "$TMPDIR_DEPLOY/auth.json"
  if sb_api PATCH "/projects/$SUPABASE_PROJECT_REF/config/auth" "$TMPDIR_DEPLOY/auth.json" | jq -r '"  site_url=" + (.site_url // "?") + " allow=" + (.uri_allow_list // "?")'; then
    ok "Site URL / リダイレクト許可を更新"
  else
    warn "Auth 設定の更新に失敗しました。Supabase ダッシュボード → Authentication → URL Configuration で手動設定してください（docs/deploy.md）"
  fi

  # メールテンプレートに 6 桁コード（{{ .Token }}）を入れる。無料枠 + 既定のメール送信では変更できない（400）ので失敗しても続行する。
  # その場合はメールの「ログイン」リンクでログインする（ウォレットの /login がリンクを受けてセッションを確立する）。
  log "Auth メールテンプレート（6 桁コード付き。カスタム SMTP 設定時のみ反映）"
  local tpl
  tpl='<h2>payCcount（デモ）ログイン</h2><p>認証コード: <strong style="font-size:24px;letter-spacing:2px">{{ .Token }}</strong></p><p>アプリの画面にこの 6 桁のコードを入力してください。</p><p>または <a href="{{ .ConfirmationURL }}">このリンク</a> を開いてもログインできます。</p><p style="color:#888">これはデモアプリケーションです。心当たりがない場合は無視してください。</p>'
  jq -cn --arg tpl "$tpl" '{
      mailer_subjects_magic_link: "【payCcount デモ】ログイン用の認証コード",
      mailer_templates_magic_link_content: $tpl,
      mailer_subjects_confirmation: "【payCcount デモ】ログイン用の認証コード",
      mailer_templates_confirmation_content: $tpl
    }' > "$TMPDIR_DEPLOY/auth-tpl.json"
  if sb_api PATCH "/projects/$SUPABASE_PROJECT_REF/config/auth" "$TMPDIR_DEPLOY/auth-tpl.json" >/dev/null 2>"$TMPDIR_DEPLOY/auth-tpl.err"; then
    ok "メールテンプレートを更新（6 桁コード）"
  else
    warn "メールテンプレートは変更できません（無料枠 + 既定のメール送信）。ユーザーはメールの「ログイン」リンクでログインします。6 桁コードにするにはカスタム SMTP を設定して再実行してください"
  fi
}

# ───────────────────────── api ─────────────────────────
cmd_api() {
  need_cmd curl jq pnpm
  need_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET
  normalize_env
  resolve_api_url

  log "Workers にデプロイ: payccount-api"
  wrangler_in apps/api deploy \
    --var "AUTH_MODE:supabase" \
    --var "APP_URL:$WEB_URL" \
    --var "ALLOWED_ORIGINS:$WEB_URL,$SHOP_JP_URL,$SHOP_GLOBAL_URL" \
    --var "DEMO_MOCK_ENDPOINTS:true" \
    --var "RATES_PROVIDER:$RATES_PROVIDER"

  log "Secrets を設定（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET）"
  jq -cn --arg u "$SUPABASE_URL" --arg k "$SUPABASE_SERVICE_ROLE_KEY" --arg j "$SUPABASE_JWT_SECRET" \
    '{SUPABASE_URL:$u, SUPABASE_SERVICE_ROLE_KEY:$k, JWT_SECRET:$j}' > "$TMPDIR_DEPLOY/secrets.json"
  wrangler_in apps/api secret bulk "$TMPDIR_DEPLOY/secrets.json"

  log "ヘルスチェック"
  local i
  for i in 1 2 3 4 5 6; do
    if curl -sS --max-time 15 "$API_URL/health" | jq -e '.ok == true' >/dev/null 2>&1; then
      curl -sS -D - -o /dev/null "$API_URL/health" | grep -i 'x-demo-mode' || true
      ok "$API_URL/health"
      return 0
    fi
    sleep 5
  done
  die "$API_URL/health が応答しません（Workers のログを確認）"
}

# ───────────────────────── web ─────────────────────────
cmd_web() {
  need_cmd curl jq pnpm
  need_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_URL SUPABASE_ANON_KEY
  normalize_env
  resolve_api_url
  ensure_pages_project "$PAGES_WEB_PROJECT"

  log "ウォレットをビルド（VITE_API_URL=$API_URL）"
  (cd "$ROOT/apps/web" && VITE_API_URL="$API_URL" VITE_SUPABASE_URL="$SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" pnpm build)

  log "Pages にデプロイ: $PAGES_WEB_PROJECT"
  wrangler_in apps/web pages deploy dist --project-name "$PAGES_WEB_PROJECT" --branch main --commit-dirty=true

  local i
  for i in 1 2 3 4 5 6; do
    if curl -sS --max-time 15 "$WEB_URL/" | grep -q '<div id="root">'; then ok "$WEB_URL"; return 0; fi
    sleep 5
  done
  warn "$WEB_URL がまだ応答しません（数分後に再確認してください）"
}

# ───────────────────────── shops ─────────────────────────
# 加盟店を用意（無ければ作成）し、新しい APIキーを発行して "merchant_id key" を返す
ensure_merchant() { # name country currency website
  local name=$1 country=$2 cur=$3 site=$4 mid key res
  mid="$(api GET /admin/merchants | jq -r --arg n "$name" '.data[] | select(.name==$n) | .id' | head -1)"
  if [ -z "$mid" ]; then
    res="$(api POST /admin/merchants "$(jq -cn --arg n "$name" --arg c "$country" --arg cur "$cur" --arg w "$site" \
      '{name:$n, country:$c, settlement_currency:$cur, website_url:$w}')")"
    mid="$(printf '%s' "$res" | jq -r '.merchant.id')"
    key="$(printf '%s' "$res" | jq -r '.api_key.key')"
    ok "加盟店を作成: $name ($mid)" >&2
  else
    key="$(api POST "/me/merchants/$mid/api-keys" | jq -r '.key')"
    ok "加盟店 $name ($mid) に新しい APIキーを発行" >&2
  fi
  [ -n "$key" ] && [ "$key" != "null" ] || die "APIキーを取得できませんでした"
  printf '%s %s' "$mid" "$key"
}

# Webhook エンドポイントを作り直してシークレットを返す
ensure_webhook() { # merchant_id url
  local mid=$1 url=$2 eid secret
  for eid in $(api GET "/me/merchants/$mid/webhook-endpoints" | jq -r --arg u "$url" '.data[] | select(.url==$u) | .id'); do
    api DELETE "/me/merchants/$mid/webhook-endpoints/$eid" >/dev/null
    ok "古い Webhook エンドポイントを削除: $eid" >&2
  done
  secret="$(api POST "/me/merchants/$mid/webhook-endpoints" "$(jq -cn --arg u "$url" '{url:$u}')" | jq -r '.secret')"
  [ -n "$secret" ] && [ "$secret" != "null" ] || die "Webhook シークレットを取得できませんでした"
  ok "Webhook エンドポイントを登録: $url" >&2
  printf '%s' "$secret"
}

deploy_shop() { # dir project url merchant_name country currency
  local dir=$1 project=$2 url=$3 mname=$4 country=$5 cur=$6
  log "$dir → $project ($url)"

  local mid key secret kv_id
  read -r mid key <<< "$(ensure_merchant "$mname" "$country" "$cur" "$url")"
  [ -n "${mid:-}" ] && [ -n "${key:-}" ] || die "加盟店 $mname の準備に失敗しました"
  secret="$(ensure_webhook "$mid" "$url/api/webhook")"
  [ -n "$secret" ] || die "Webhook の準備に失敗しました"
  kv_id="$(ensure_kv_namespace "$project-orders")"

  # wrangler.toml に KV の ID・API URL・プロジェクト名を反映（秘密は含まない）
  local toml="$ROOT/$dir/wrangler.toml"
  sed -i -E "s#^name = \".*\"#name = \"$project\"#; s#^id = \".*\"#id = \"$kv_id\"#; s#^PAYCCOUNT_API_URL = \".*\"#PAYCCOUNT_API_URL = \"$API_URL\"#" "$toml"

  ensure_pages_project "$project"

  jq -cn --arg k "$key" --arg s "$secret" --arg u "$url" '{PAYCCOUNT_SECRET_KEY:$k, PAYCCOUNT_WEBHOOK_SECRET:$s, SHOP_URL:$u}' > "$TMPDIR_DEPLOY/shop-secrets.json"
  wrangler_in "$dir" pages secret bulk "$TMPDIR_DEPLOY/shop-secrets.json" --project-name "$project"

  (cd "$ROOT/$dir" && pnpm build)
  wrangler_in "$dir" pages deploy --project-name "$project" --branch main --commit-dirty=true
  ok "$url"
}

cmd_shops() {
  need_cmd curl jq pnpm
  need_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_URL SUPABASE_ANON_KEY
  normalize_env
  resolve_api_url
  TOKEN="$(admin_token)"

  deploy_shop apps/shop-jp     "$PAGES_SHOP_JP_PROJECT"     "$SHOP_JP_URL"     "サクラ雑貨店" JP JPY
  deploy_shop apps/shop-global "$PAGES_SHOP_GLOBAL_PROJECT" "$SHOP_GLOBAL_URL" "Globe Goods"  US USD

  if ! git -C "$ROOT" diff --quiet -- apps/shop-jp/wrangler.toml apps/shop-global/wrangler.toml; then
    warn "apps/shop-*/wrangler.toml（KV ID / API URL）が更新されました。コミットしてください"
  fi
}

# ───────────────────────── smoke ─────────────────────────
cmd_smoke() {
  need_cmd curl jq
  need_env CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID SUPABASE_URL SUPABASE_ANON_KEY
  normalize_env
  resolve_api_url

  log "疎通"
  curl -sS "$API_URL/health" | jq -c .
  for u in "$WEB_URL" "$SHOP_JP_URL" "$SHOP_GLOBAL_URL"; do
    printf '  %s -> HTTP %s\n' "$u" "$(curl -sS -o /dev/null -w '%{http_code}' "$u/")"
  done
  printf '  shop-jp config: %s\n' "$(curl -sS "$SHOP_JP_URL/api/config")"

  log "管理者ログイン（Supabase Auth → /me）"
  TOKEN="$(admin_token)"
  api GET /me | jq -c '{email: .profile.email, role: .profile.role, total_jpy: .total_jpy}'

  log "カードチャージ ¥5,000（テスト番号）"
  api POST /me/topups/card '{"amount":"5000","currency":"JPY","card":{"number":"4242424242424242","exp":"12/30","cvc":"123"}}' | jq -c '{status, amount}'

  log "shop-jp で注文 → Checkout Session"
  local co sid oid
  co="$(curl -sS -X POST "$SHOP_JP_URL/api/checkout" -H 'Content-Type: application/json' --data '{"items":[{"id":"p-tenugui","qty":1}]}')"
  sid="$(printf '%s' "$co" | jq -r '.session_id // empty')"
  oid="$(printf '%s' "$co" | jq -r '.order_id // empty')"
  [ -n "$sid" ] || { printf '%s\n' "$co" >&2; die "Checkout Session を作成できませんでした（shop の secrets / APIキーを確認）"; }
  ok "session=$sid order=$oid"
  api GET "/me/checkout/sessions/$sid" | jq -c '{merchant: .merchant.name, amount: .session.amount, currency: .session.currency, sources: [.sources[]? | {currency, amount, sufficient}]}' || true

  log "JPY で支払う → Webhook で注文が「支払済」になるのを待つ"
  api POST "/me/checkout/sessions/$sid/confirm" '{"source_currency":"JPY"}' | jq -c '{payment: .payment.id, status: .payment.status, redirect_url}'
  local i st
  for i in $(seq 1 12); do
    st="$(curl -sS "$SHOP_JP_URL/api/orders/$oid" | jq -r '.status // empty')"
    [ "$st" = "paid" ] && break
    sleep 5
  done
  if [ "$st" = "paid" ]; then ok "注文 $oid は支払済（Webhook 受信）"; else warn "注文の状態: ${st:-?}（Webhook はCron で再送されます。加盟店ダッシュボードのイベントログを確認）"; fi

  log "台帳整合性"
  api GET /admin/ledger/verify | jq -c .
}

# ───────────────────────── main ─────────────────────────
case "$CMD" in
  check)    cmd_check ;;
  supabase) cmd_supabase ;;
  api)      cmd_api ;;
  web)      cmd_web ;;
  shops)    cmd_shops ;;
  smoke)    cmd_smoke ;;
  all)
    cmd_check
    cmd_supabase
    cmd_api
    cmd_web
    cmd_shops
    cmd_smoke
    log "完了"
    echo "  ウォレット   : $WEB_URL（管理者: ID kuro）"
    echo "  API         : $API_URL"
    echo "  shop-jp     : $SHOP_JP_URL"
    echo "  shop-global : $SHOP_GLOBAL_URL"
    ;;
  *)
    echo "usage: $0 {check|supabase|api|web|shops|smoke|all}" >&2
    exit 2
    ;;
esac
