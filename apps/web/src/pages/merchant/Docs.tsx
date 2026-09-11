import { marked } from 'marked';
import { useMemo, useState } from 'react';
import docsMd from '../../../../../docs/api.md?raw';
import { Card, PageTitle } from '../../components/ui';
import { API_URL } from '../../lib/api';
import { useMerchant } from '../../lib/merchant';

type Lang = 'node' | 'curl' | 'browser';

/** /merchant/docs — docs/api.md をレンダリング + SDK コードスニペット */
export function MerchantDocsPage() {
  const { merchant } = useMerchant();
  const [lang, setLang] = useState<Lang>('node');
  const appUrl = window.location.origin;
  const html = useMemo(() => {
    const md = docsMd.replaceAll('{{API_URL}}', API_URL).replaceAll('{{APP_URL}}', appUrl);
    return marked.parse(md, { async: false }) as string;
  }, [appUrl]);

  const snippets: Record<Lang, string> = {
    node: `// npm i @payccount/js（このリポジトリでは packages/sdk）
import { PayCcount } from '@payccount/js';

const payccount = new PayCcount(process.env.PAYCCOUNT_SECRET_KEY!, {
  baseUrl: '${API_URL}',
});

// 1. Checkout Session を作成してお客様をリダイレクト
const session = await payccount.checkout.sessions.create(
  {
    amount: '5980',           // 最小単位の文字列（${merchant?.settlement_currency ?? 'JPY'}）
    currency: '${merchant?.settlement_currency ?? 'JPY'}',
    order_id: 'ORDER-1001',
    description: '商品A ×1',
    success_url: 'https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://shop.example/cart',
  },
  { idempotencyKey: 'ORDER-1001' },
);
redirect(session.url);

// 2. Webhook を検証して注文を「支払済」にする
const event = await payccount.webhooks.constructEvent(rawBody, req.headers.get('X-payCcount-Signature'), process.env.PAYCCOUNT_WEBHOOK_SECRET!);
if (event.type === 'payment.succeeded') {
  markOrderPaid(event.data.object.order_id);
}

// 3. 返金（部分返金可）
await payccount.payments.refund(paymentId, { amount: '1000', reason: 'requested_by_customer' }, { idempotencyKey: 'refund-1' });`,
    curl: `# Checkout Session の作成
curl -X POST ${API_URL}/v1/checkout/sessions \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Idempotency-Key: ORDER-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "5980",
    "currency": "${merchant?.settlement_currency ?? 'JPY'}",
    "order_id": "ORDER-1001",
    "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://shop.example/cart"
  }'

# 決済一覧
curl ${API_URL}/v1/payments -H "Authorization: Bearer sk_test_..."

# 返金
curl -X POST ${API_URL}/v1/payments/pay_.../refunds \\
  -H "Authorization: Bearer sk_test_..." -H "Idempotency-Key: refund-1" \\
  -H "Content-Type: application/json" -d '{"amount":"1000"}'`,
    browser: `<!-- 「payCcountで支払う」ボタンを描画する軽量スクリプト -->
<script src="${appUrl}/sdk/pay.js" data-session="cs_..."></script>

<!-- または SDK から -->
<script type="module">
  import { redirectToCheckout } from '@payccount/js/browser';
  redirectToCheckout('cs_...', { appUrl: '${appUrl}' });
</script>`,
  };

  return (
    <div className="space-y-4">
      <PageTitle sub="加盟店向け統合ガイド（docs/api.md）と SDK スニペット">ドキュメント</PageTitle>
      <Card title="SDK コードスニペット">
        <div className="mb-2 flex gap-1 text-xs">
          {(['node', 'curl', 'browser'] as Lang[]).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={`rounded-full px-3 py-1 ${lang === l ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {l === 'node' ? 'Node / Workers' : l === 'curl' ? 'cURL' : 'ブラウザ'}
            </button>
          ))}
        </div>
        <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
          <code>{snippets[lang]}</code>
        </pre>
      </Card>
      <Card>
        <article className="prose-docs text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: html }} />
      </Card>
    </div>
  );
}
