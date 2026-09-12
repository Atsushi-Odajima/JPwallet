import type { CheckoutSession, Page, Payment } from '@payccount/shared';
import { useQuery } from '@tanstack/react-query';
import { Amount } from '../../components/Amount';
import { Badge, Card, EmptyState, ErrorText, Spinner, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { paymentStatusLabel, sessionStatusLabel } from '../../i18n/labels';
import { api, errorMessage } from '../../lib/api';

type AdminPayment = Payment & { merchant_name: string; payer_email: string | null };
type AdminSession = CheckoutSession & { merchant_name: string };

/** /admin/payments — 全加盟店の決済と Checkout Session */
export function AdminPaymentsPage() {
  const { t } = useI18n();
  const payments = useQuery({ queryKey: ['admin', 'payments'], queryFn: () => api.get<Page<AdminPayment>>('/admin/payments?limit=100'), refetchInterval: 15_000 });
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api.get<{ data: AdminSession[] }>('/admin/checkout-sessions'), refetchInterval: 15_000 });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('a.payments.title')}</h1>
      <Card title={t('a.payments.all_merchants')}>
        {payments.isLoading && <Spinner />}
        {payments.error && <ErrorText>{errorMessage(payments.error)}</ErrorText>}
        {payments.data && payments.data.data.length === 0 && <EmptyState>{t('a.payments.empty')}</EmptyState>}
        {payments.data && payments.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm [&_td]:pr-3 [&_th]:pr-3">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">{t('common.date')}</th>
                  <th>{t('common.merchant')}</th>
                  <th>{t('a.payments.th_payer')}</th>
                  <th>{t('a.payments.th_paid')}</th>
                  <th className="text-right">{t('a.payments.th_settlement')}</th>
                  <th className="text-right">{t('common.fee')}</th>
                  <th>{t('common.rate')}</th>
                  <th className="text-right">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.data.data.map((p) => {
                  const status = paymentStatusLabel(t, p.status);
                  return (
                    <tr key={p.id}>
                      <td className="py-2 text-xs text-slate-500">{formatDate(p.created_at)}</td>
                      <td>{p.merchant_name}</td>
                      <td className="text-xs">{p.payer_email}</td>
                      <td className="text-xs">
                        <Amount value={p.source_amount} currency={p.source_currency} symbol={false} code trimZeros />
                      </td>
                      <td className="text-right">
                        <Amount value={p.settlement_amount} currency={p.settlement_currency} />
                      </td>
                      <td className="text-right text-xs text-slate-500">
                        <Amount value={p.fee_amount} currency={p.settlement_currency} />
                      </td>
                      <td className="text-xs text-slate-500">
                        {p.source_currency === p.settlement_currency
                          ? '-'
                          : t('a.payments.rate_with_spread', { rate: Number(p.fx_rate).toLocaleString('ja-JP', { maximumFractionDigits: 6 }), spread: p.spread_bps / 100 })}
                      </td>
                      <td className="text-right">
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={t('a.payments.sessions_title')}>
        {sessions.isLoading && <Spinner />}
        {sessions.data && sessions.data.data.length === 0 && <EmptyState>{t('a.payments.sessions_empty')}</EmptyState>}
        {sessions.data && sessions.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs [&_td]:pr-3 [&_th]:pr-3">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1">ID</th>
                  <th>{t('common.merchant')}</th>
                  <th>{t('common.order')}</th>
                  <th className="text-right">{t('common.amount')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('a.payments.th_expires')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.data.data.map((s) => {
                  const status = sessionStatusLabel(t, s.status);
                  return (
                    <tr key={s.id}>
                      <td className="py-1 font-mono">{s.id}</td>
                      <td>{s.merchant_name}</td>
                      <td>{s.order_id ?? '-'}</td>
                      <td className="text-right">
                        <Amount value={s.amount} currency={s.currency} />
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="text-slate-500">{formatDate(s.expires_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
