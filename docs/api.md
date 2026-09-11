# payCcount 加盟店向け API リファレンス（デモ）

> これはデモアプリケーションです。実際の資金は扱いません。すべてのレスポンスに `X-Demo-Mode: true` が付きます。

ベース URL: `{{API_URL}}`（ローカル: `http://localhost:8787`）

## 認証

`Authorization: Bearer sk_test_...`

APIキーは加盟店ダッシュボードの「開発者」で発行します。平文キーは発行時に一度だけ表示されます。

## 共通ルール

- 金額は **最小単位の整数を文字列** で指定します（`"amount": "5980"`, `"currency": "JPY"`。USD なら `"1500"` = $15.00）
- `POST` には `Idempotency-Key` ヘッダーが **必須** です。同一キー + 同一ボディなら同じレスポンス（`Idempotency-Replayed: true`）、同一キー + 異なるボディなら `409`
- レート制限: APIキーごとに 60 req/分。超過で `429`
- ページネーション: `?limit=20&starting_after=<id>` → `{ "data": [...], "has_more": true }`

（詳細は Phase 6 で追記）
