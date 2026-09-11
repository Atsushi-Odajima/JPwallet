# @payccount/js — payCcount 加盟店向け SDK（デモ）

> これはデモアプリケーションの SDK です。実際の資金は扱いません。

Node 18+ / Cloudflare Workers / Pages Functions で動きます（`fetch` と Web Crypto のみ使用）。

## インストール

このリポジトリ内では pnpm workspace で `"@payccount/js": "workspace:*"` として参照します。

## サーバー側

```ts
import { PayCcount } from '@payccount/js';

const payccount = new PayCcount(process.env.PAYCCOUNT_SECRET_KEY!, {
  baseUrl: process.env.PAYCCOUNT_API_URL, // 例: http://localhost:8787
});

// Checkout Session を作成し、お客様を session.url へリダイレクト
const session = await payccount.checkout.sessions.create(
  {
    amount: '5980',            // 最小単位の文字列（JPY は円、USD はセント）
    currency: 'JPY',           // 加盟店の精算通貨と一致させる
    order_id: 'ORDER-1001',
    description: '商品A ×1',
    success_url: 'https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://shop.example/cart',
    accepted_sources: ['JPY', 'PT', 'USD', 'BTC', 'ETH'], // 省略時は全部
  },
  { idempotencyKey: 'ORDER-1001' },
);

// 決済・返金
const payments = await payccount.payments.list({ limit: 20 });
const refund = await payccount.payments.refund('pay_...', { amount: '1000', reason: 'requested_by_customer' }, { idempotencyKey: 'refund-1' });

// 残高
const balance = await payccount.balance.retrieve();

// Webhook エンドポイント / イベント
const endpoint = await payccount.webhookEndpoints.create({ url: 'https://shop.example/api/webhook', events: ['payment.succeeded', 'payment.refunded'] });
console.log(endpoint.secret); // 作成時のみ
await payccount.events.resend('evt_...');
```

## Webhook の検証

```ts
import { constructEvent, WebhookSignatureError } from '@payccount/js/webhooks';

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text(); // 生の本文をそのまま渡す
  try {
    const event = await constructEvent(rawBody, request.headers.get('X-payCcount-Signature'), env.PAYCCOUNT_WEBHOOK_SECRET);
    if (event.type === 'payment.succeeded') {
      // event.data.object は Payment
    }
    return new Response('ok');
  } catch (e) {
    if (e instanceof WebhookSignatureError) return new Response('invalid signature', { status: 400 });
    throw e;
  }
}
```

署名ヘッダー: `X-payCcount-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + body))>`。許容ずれはデフォルト 300 秒。

## ブラウザ側（任意）

```ts
import { redirectToCheckout, renderPayButton } from '@payccount/js/browser';
redirectToCheckout(session.id, { appUrl: 'https://wallet.example' });
```

または軽量スクリプト:

```html
<script src="https://wallet.example/sdk/pay.js" data-session="cs_..."></script>
```

## エラー

API エラーは `PayCcountError`（`status`, `type`, `code`, `message`, `param`, `requestId`）として投げられます。

## 冪等性

`POST` 系のメソッドは `idempotencyKey` を省略すると自動生成します。注文 ID を渡すと再送に安全です。
