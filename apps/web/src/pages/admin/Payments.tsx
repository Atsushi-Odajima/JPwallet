import type { CheckoutSession, Page, Payment } from '@payccount/shared';
import { useQuery } from '@tanstack/react-query';
import { Amount } from '../../components/Amount';
import { Badge, Card, EmptyState, ErrorText, Spinner, formatDate } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { PAYMENT_STATUS_LABEL } from '../merchant/Overview';

type AdminPayment = Payment & { merchant_name: string; payer_email: string | null };
type AdminSession = CheckoutSession & { merchant_name: string };

/** /admin/payments — 全加盟店の決済と Checkout Session */
export function AdminPaymentsPage() {
  const payments = useQuery({ queryKey: ['admin', 'payments'], queryFn: () => api.get<Page<AdminPayment>>('/admin/payments?limit=100'), refetchInterval: 15_000 });
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api.get<{ data: AdminSession[] }>('/admin/checkout-sessions'), refetchInterval: 15_000 });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">決済</h1>
      <Card title="決済（全加盟店）">
        {payments.isLoading && <Spinner />}
        {payments.error && <ErrorText>{errorMessage(payments.error)}</ErrorText>}
        {payments.data && payments.data.data.length === 0 && <EmptyState>決済はありません</EmptyState>}
        {payments.data && payments.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">日時</th>
                  <th>加盟店</th>
                  <th>支払者</th>
                  <th>支払</th>
                  <th className="text-right">精算</th>
                  <th className="text-right">手数料</th>
                  <th>レート</th>
                  <th className="text-right">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.data.data.map((p) => (
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
                    <td className="text-xs text-slate-500">{p.source_currency === p.settlement_currency ? '-' : `${Number(p.fx_rate).toLocaleString('ja-JP', { maximumFractionDigits: 6 })}（${p.spread_bps / 100}%）`}</td>
                    <td className="text-right">
                      <Badge tone={PAYMENT_STATUS_LABEL[p.status]?.tone ?? 'slate'}>{PAYMENT_STATUS_LABEL[p.status]?.label ?? p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Checkout Session（直近 100 件）">
        {sessions.isLoading && <Spinner />}
        {sessions.data && sessions.data.data.length === 0 && <EmptyState>Session はありません</EmptyState>}
        {sessions.data && sessions.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1">ID</th>
                  <th>加盟店</th>
                  <th>注文</th>
                  <th className="text-right">金額</th>
                  <th>状態</th>
                  <th>期限</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.data.data.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1 font-mono">{s.id}</td>
                    <td>{s.merchant_name}</td>
                    <td>{s.order_id ?? '-'}</td>
                    <td className="text-right">
                      <Amount value={s.amount} currency={s.currency} />
                    </td>
                    <td>
                      <Badge tone={s.status === 'completed' ? 'green' : s.status === 'open' ? 'amber' : 'slate'}>{s.status}</Badge>
                    </td>
                    <td className="text-slate-500">{formatDate(s.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
