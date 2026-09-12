import { marked } from 'marked';
import { useMemo, useState } from 'react';
import docsEn from '../../../../../docs/api.en.md?raw';
import docsMd from '../../../../../docs/api.md?raw';
import { Card, PageTitle } from '../../components/ui';
import { useI18n } from '../../i18n';
import { API_URL } from '../../lib/api';
import { useMerchant } from '../../lib/merchant';

type Lang = 'node' | 'curl' | 'browser';

/** /merchant/docs — docs/api.md をレンダリング + SDK コードスニペット */
export function MerchantDocsPage() {
  const { t, locale } = useI18n();
  const { merchant } = useMerchant();
  const [lang, setLang] = useState<Lang>('node');
  const appUrl = window.location.origin;
  const html = useMemo(() => {
    const md = (locale === 'ja' ? docsMd : docsEn).replaceAll('{{API_URL}}', API_URL).replaceAll('{{APP_URL}}', appUrl);
    return marked.parse(md, { async: false }) as string;
  }, [appUrl, locale]);

  const settlement = merchant?.settlement_currency ?? 'JPY';
  const snippets: Record<Lang, string> = {
    node: `${t('m.docs.snip.node_install')}
import { PayCcount } from '@payccount/js';

const payccount = new PayCcount(process.env.PAYCCOUNT_SECRET_KEY!, {
  baseUrl: '${API_URL}',
});

${t('m.docs.snip.node_step1')}
const session = await payccount.checkout.sessions.create(
  {
    amount: '5980',           ${t('m.docs.snip.node_amount', { currency: settlement })}
    currency: '${settlement}',
    order_id: 'ORDER-1001',
    description: '${t('m.docs.snip.node_description')}',
    success_url: 'https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://shop.example/cart',
  },
  { idempotencyKey: 'ORDER-1001' },
);
redirect(session.url);

${t('m.docs.snip.node_step2')}
const event = await payccount.webhooks.constructEvent(rawBody, req.headers.get('X-payCcount-Signature'), process.env.PAYCCOUNT_WEBHOOK_SECRET!);
if (event.type === 'payment.succeeded') {
  markOrderPaid(event.data.object.order_id);
}

${t('m.docs.snip.node_step3')}
await payccount.payments.refund(paymentId, { amount: '1000', reason: 'requested_by_customer' }, { idempotencyKey: 'refund-1' });`,
    curl: `${t('m.docs.snip.curl_create')}
curl -X POST ${API_URL}/v1/checkout/sessions \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Idempotency-Key: ORDER-1001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "5980",
    "currency": "${settlement}",
    "order_id": "ORDER-1001",
    "success_url": "https://shop.example/thanks?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://shop.example/cart"
  }'

${t('m.docs.snip.curl_list')}
curl ${API_URL}/v1/payments -H "Authorization: Bearer sk_test_..."

${t('m.docs.snip.curl_refund')}
curl -X POST ${API_URL}/v1/payments/pay_.../refunds \\
  -H "Authorization: Bearer sk_test_..." -H "Idempotency-Key: refund-1" \\
  -H "Content-Type: application/json" -d '{"amount":"1000"}'`,
    browser: `${t('m.docs.snip.browser_button')}
<script src="${appUrl}/sdk/pay.js" data-session="cs_..."></script>

${t('m.docs.snip.browser_or_sdk')}
<script type="module">
  import { redirectToCheckout } from '@payccount/js/browser';
  redirectToCheckout('cs_...', { appUrl: '${appUrl}' });
</script>`,
  };

  return (
    <div className="space-y-4">
      <PageTitle sub={t('m.docs.subtitle', { file: locale === 'ja' ? 'docs/api.md' : 'docs/api.en.md' })}>{t('m.docs.title')}</PageTitle>
      <Card title={t('m.docs.snippets_title')}>
        <div className="mb-2 flex gap-1 text-xs">
          {(['node', 'curl', 'browser'] as Lang[]).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={`rounded-full px-3 py-1 ${lang === l ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {l === 'node' ? 'Node / Workers' : l === 'curl' ? 'cURL' : t('m.docs.lang_browser')}
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
