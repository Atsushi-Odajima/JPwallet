#!/usr/bin/env bash
# ローカル Postgres（Supabase を使わない開発・テスト用）
#   pnpm db:start   … クラスタを初期化して起動し、DB 作成 + マイグレーション + シードを適用
#   pnpm db:reset   … DB を作り直してマイグレーション + シードを再適用
#   pnpm db:migrate … マイグレーションだけ再適用（create or replace を活かす）
#   pnpm db:stop    … 停止
#   pnpm db:psql    … psql で接続
#
# 接続先は DATABASE_URL で上書きできる（デフォルト: postgres://payccount:payccount@127.0.0.1:54329/payccount）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGDATA="${PAYCCOUNT_PGDATA:-$ROOT/.pgdata}"
PGPORT="${PAYCCOUNT_PGPORT:-54329}"
PGHOST=127.0.0.1
DB_USER=payccount
DB_PASS=payccount
DB_NAME="${PAYCCOUNT_DB_NAME:-payccount}"
LOG="$PGDATA/postgres.log"

find_pg_bin() {
  if command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  for d in /usr/lib/postgresql/*/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
    if [ -x "$d/pg_ctl" ]; then echo "$d"; return; fi
  done
  echo "pg_ctl が見つかりません。PostgreSQL 15 以上をインストールしてください" >&2
  exit 1
}
PGBIN="$(find_pg_bin)"

# root で実行された場合は postgres OS ユーザーで動かす（initdb は root を拒否する）
run_pg() {
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

ensure_dirs() {
  mkdir -p "$PGDATA"
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
    chown -R postgres:postgres "$PGDATA"
  fi
}

superuser_psql() {
  # クラスタ作成者（= postgres or 現在ユーザー）として接続
  local su_user
  if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then su_user=postgres; else su_user="$(id -un)"; fi
  run_pg "$PGBIN/psql" -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$su_user" "$@"
}

app_psql() {
  PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$DB_PASS" \
    "$PGBIN/psql" -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

is_running() {
  run_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1
}

start_cluster() {
  ensure_dirs
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "▶ initdb $PGDATA"
    run_pg "$PGBIN/initdb" -D "$PGDATA" --auth=trust --encoding=UTF8 --locale=C >/dev/null
    cat >> "$PGDATA/postgresql.conf" <<EOF
port = $PGPORT
listen_addresses = '$PGHOST'
unix_socket_directories = '$PGDATA'
fsync = off
synchronous_commit = off
full_page_writes = off
EOF
  fi
  if ! is_running; then
    echo "▶ postgres 起動 (port $PGPORT)"
    run_pg "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOG" -w start >/dev/null
  fi
}

ensure_role_and_db() {
  superuser_psql -d postgres -tAc "select 1 from pg_roles where rolname = '$DB_USER'" | grep -q 1 || \
    superuser_psql -d postgres -c "create role $DB_USER login superuser password '$DB_PASS'" >/dev/null
  superuser_psql -d postgres -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1 || \
    superuser_psql -d postgres -c "create database $DB_NAME owner $DB_USER" >/dev/null
}

drop_db() {
  superuser_psql -d postgres -c "drop database if exists $DB_NAME with (force)" >/dev/null
}

migrate() {
  echo "▶ auth スタブ（ローカル専用）"
  app_psql -q -f "$ROOT/scripts/db/local-auth-stub.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "▶ migrate $(basename "$f")"
    app_psql -q -f "$f"
  done
  echo "▶ seed"
  app_psql -q -f "$ROOT/supabase/seed.sql"
  app_psql -q -f "$ROOT/scripts/db/local-seed.sql"
}

print_url() {
  echo ""
  echo "DATABASE_URL=postgres://$DB_USER:$DB_PASS@$PGHOST:$PGPORT/$DB_NAME"
}

case "${1:-}" in
  start)
    start_cluster
    ensure_role_and_db
    migrate
    print_url
    ;;
  reset)
    start_cluster
    drop_db
    ensure_role_and_db
    migrate
    print_url
    ;;
  migrate)
    start_cluster
    ensure_role_and_db
    migrate
    ;;
  stop)
    if is_running; then
      run_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null
      echo "停止しました"
    else
      echo "起動していません"
    fi
    ;;
  status)
    if is_running; then echo "running (port $PGPORT)"; print_url; else echo "stopped"; exit 1; fi
    ;;
  psql)
    shift
    app_psql "$@"
    ;;
  *)
    echo "usage: $0 {start|reset|migrate|stop|status|psql}" >&2
    exit 2
    ;;
esac
