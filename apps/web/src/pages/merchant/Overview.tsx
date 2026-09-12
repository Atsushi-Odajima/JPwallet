import type { Balance, Merchant, Payment } from '@payccount/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Amount } from '../../components/Amount';
import { Badge, Card, EmptyState, ErrorText, PageTitle, Spinner, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { paymentStatusLabel } from '../../i18n/labels';
import { api, errorMessage } from '../../lib/api';
import { merchantPath, useMerchant } from '../../lib/merchant';

interface Dashboard {
  merchant: Merchant;
  balance: Balance;
  stats: {
    payments_count: number;
    payments_today: number;
    gross_volume: string;
    gross_volume_today: string;
    fees_total: string;
    refunded_total: string;
    open_sessions: number;
    webhook_failed: number;
    api_keys_active: number;
    webhook_endpoints: number;
  };
  recent_payments: Payment[];
  by_source: { source_currency: string; count: number; settlement_amount: string }[];
}

/** /merchant — 売上サマリ、残高（精算通貨）、直近決済 */
export function MerchantOverviewPage() {
  const { t } = useI18n();
  const { merchant } = useMerchant();
  const q = useQuery({
    queryKey: ['merchant', merchant?.id, 'dashboard'],
    queryFn: () => api.get<Dashboard>(merchantPath(merchant!.id, '/dashboard')),
    enabled: !!merchant,
    refetchInterval: 10_000,
  });
  if (!merchant) return null;
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorText>{errorMessage(q.error)}</ErrorText>;
  const d = q.data!;
  const cur = merchant.settlement_currency;
  const available = d.balance.available.find((b) => b.currency === cur)?.amount ?? '0';

  return (
    <div className="space-y-4">
      <PageTitle sub={t('m.overview.subtitle', { name: merchant.name, currency: cur, fee: merchant.fee_bps / 100 })}>{t('m.overview.title')}</PageTitle>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('m.overview.available_balance')} value={<Amount value={available} currency={cur} />} accent />
        <Stat label={t('m.overview.gross_volume')} value={<Amount value={d.stats.gross_volume} currency={cur} />} sub={t('m.overview.today_amount', { amount: fmt(d.stats.gross_volume_today, cur) })} />
        <Stat label={t('m.overview.payments_count')} value={String(d.stats.payments_count)} sub={t('m.overview.today_count', { n: d.stats.payments_today })} />
        <Stat label={t('m.overview.fees_refunds')} value={<Amount value={d.stats.fees_total} currency={cur} />} sub={t('m.overview.refunded_amount', { amount: fmt(d.stats.refunded_total, cur) })} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={t('m.overview.recent_payments')} className="lg:col-span-2" action={<Link to="/merchant/payments" className="text-xs text-brand-600">{t('common.view_all')}</Link>}>
          {d.recent_payments.length === 0 && <EmptyState>{t('m.overview.no_payments')}</EmptyState>}
          {d.recent_payments.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm [&_td]:pr-3 [&_th]:pr-3">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1">{t('common.date')}</th>
                    <th>{t('common.order')}</th>
                    <th>{t('m.col.paid')}</th>
                    <th className="text-right">{t('m.col.settlement')}</th>
                    <th className="text-right">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.recent_payments.map((p) => {
                    const st = paymentStatusLabel(t, p.status);
                    return (
                      <tr key={p.id}>
                        <td className="py-2 text-xs text-slate-500">{formatDate(p.created_at)}</td>
                        <td className="max-w-40 truncate">{p.order_id ?? p.description ?? '-'}</td>
                        <td className="text-xs">
                          <Amount value={p.source_amount} currency={p.source_currency} code symbol={false} trimZeros />
                        </td>
                        <td className="text-right font-medium">
                          <Amount value={p.settlement_amount} currency={p.settlement_currency} />
                        </td>
                        <td className="text-right">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title={t('m.overview.by_source')}>
            {d.by_source.length === 0 && <EmptyState>{t('m.overview.no_data')}</EmptyState>}
            <ul className="space-y-1 text-sm">
              {d.by_source.map((s) => (
                <li key={s.source_currency} className="flex justify-between">
                  <span>
                    {s.source_currency} <span className="text-xs text-slate-500">× {s.count}</span>
                  </span>
                  <Amount value={s.settlement_amount} currency={cur} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('m.overview.integration')}>
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between">
                <span>{t('m.overview.active_keys')}</span>
                <span className="font-medium">{d.stats.api_keys_active}</span>
              </li>
              <li className="flex justify-between">
                <span>{t('m.overview.webhook_endpoints')}</span>
                <span className="font-medium">{d.stats.webhook_endpoints}</span>
              </li>
              <li className="flex justify-between">
                <span>{t('m.overview.failed_deliveries')}</span>
                <span className={`font-medium ${d.stats.webhook_failed > 0 ? 'text-rose-600' : ''}`}>{d.stats.webhook_failed}</span>
              </li>
              <li className="flex justify-between">
                <span>{t('m.overview.open_sessions')}</span>
                <span className="font-medium">{d.stats.open_sessions}</span>
              </li>
            </ul>
            <Link to="/merchant/developers" className="mt-3 inline-block text-xs text-brand-600 underline">
              {t('m.overview.to_developers')}
            </Link>
          </Card>
        </div>
      </div>

      <Card title={t('m.overview.getting_started')}>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            {t('m.overview.step1_before')}<Link to="/merchant/developers" className="text-brand-600 underline">{t('m.overview.step1_link')}</Link>{t('m.overview.step1_after')}
          </li>
          <li>
            {t('m.overview.step2_before')}<code className="rounded bg-slate-100 px-1">POST /v1/checkout/sessions</code>{t('m.overview.step2_mid')}<code className="rounded bg-slate-100 px-1">url</code>{t('m.overview.step2_after')}
          </li>
          <li>
            {t('m.overview.step3_before')}<code className="rounded bg-slate-100 px-1">payment.succeeded</code>{t('m.overview.step3_after', { currency: cur })}
          </li>
          <li>{t('m.overview.step4')}</li>
        </ol>
        <Link to="/merchant/docs" className="mt-2 inline-block text-xs text-brand-600 underline">
          {t('m.overview.to_docs')}
        </Link>
      </Card>
    </div>
  );
}

function fmt(minor: string, currency: string) {
  try {
    return new Intl.NumberFormat('ja-JP').format(Number(minor) / 10 ** (currency === 'JPY' ? 0 : 2)) + ' ' + currency;
  } catch {
    return `${minor} ${currency}`;
  }
}

function Stat({ label, value, sub, accent = false }: { label: string; value: React.ReactNode; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 shadow-sm ${accent ? 'bg-gradient-to-br from-brand-700 to-brand-500 text-white' : 'border border-slate-200 bg-white'}`}>
      <p className={`text-xs ${accent ? 'text-brand-100' : 'text-slate-500'}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold tabular">{value}</p>
      {sub && <p className={`text-xs ${accent ? 'text-brand-100' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  );
}
