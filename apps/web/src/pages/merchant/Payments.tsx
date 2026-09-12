import { formatRate, minorToDecimalString, parseAmount, type Page, type Payment, type Refund } from '@payccount/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Amount } from '../../components/Amount';
import { Badge, Button, Card, EmptyState, ErrorText, Input, PageTitle, Row, Select, Spinner, SuccessText, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { paymentStatusLabel } from '../../i18n/labels';
import { api, errorMessage } from '../../lib/api';
import { merchantPath, useMerchant } from '../../lib/merchant';

/** /merchant/payments — 決済一覧・詳細・返金 */
export function MerchantPaymentsPage() {
  const { t } = useI18n();
  const { merchant } = useMerchant();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['merchant', merchant?.id, 'payments', status],
    queryFn: ({ pageParam }) => {
      const s = new URLSearchParams({ limit: '20' });
      if (status) s.set('status', status);
      if (pageParam) s.set('starting_after', pageParam);
      return api.get<Page<Payment>>(merchantPath(merchant!.id, `/payments?${s}`));
    },
    initialPageParam: '',
    getNextPageParam: (last) => (last.has_more ? last.data[last.data.length - 1]?.id : undefined),
    enabled: !!merchant,
  });
  if (!merchant) return null;
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-4">
      <PageTitle sub={t('m.payments.subtitle')}>{t('m.payments.title')}</PageTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="mb-3 w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('m.payments.all_statuses')}</option>
              <option value="succeeded">{t('payment_status.succeeded')}</option>
              <option value="partially_refunded">{t('payment_status.partially_refunded')}</option>
              <option value="refunded">{t('payment_status.refunded')}</option>
            </Select>
          </div>
          {q.isLoading && <Spinner />}
          {!q.isLoading && items.length === 0 && <EmptyState>{t('m.payments.empty')}</EmptyState>}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm [&_td]:pr-3 [&_th]:pr-3">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1">{t('common.date')}</th>
                    <th>{t('m.payments.payment_id')}</th>
                    <th>{t('common.order')}</th>
                    <th>{t('m.col.paid')}</th>
                    <th className="text-right">{t('m.col.settlement')}</th>
                    <th className="text-right">{t('common.fee')}</th>
                    <th className="text-right">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((p) => {
                    const st = paymentStatusLabel(t, p.status);
                    return (
                      <tr key={p.id} className={`cursor-pointer hover:bg-slate-50 ${selected === p.id ? 'bg-brand-50' : ''}`} onClick={() => setSelected(p.id)}>
                        <td className="py-2 text-xs text-slate-500">{formatDate(p.created_at)}</td>
                        <td className="font-mono text-xs">{p.id.slice(0, 14)}…</td>
                        <td className="max-w-40 truncate">{p.order_id ?? p.description ?? '-'}</td>
                        <td className="text-xs">
                          <Amount value={p.source_amount} currency={p.source_currency} symbol={false} code trimZeros />
                        </td>
                        <td className="text-right font-medium">
                          <Amount value={p.settlement_amount} currency={p.settlement_currency} />
                        </td>
                        <td className="text-right text-xs text-slate-500">
                          <Amount value={p.fee_amount} currency={p.settlement_currency} />
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
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-3 w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              {t('common.load_more')}
            </Button>
          )}
        </Card>
        <div className="min-w-0">{selected ? <PaymentDetail merchantId={merchant.id} paymentId={selected} /> : <Card><EmptyState>{t('m.payments.select_hint')}</EmptyState></Card>}</div>
      </div>
    </div>
  );
}

function PaymentDetail({ merchantId, paymentId }: { merchantId: string; paymentId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['merchant', merchantId, 'payment', paymentId],
    queryFn: () => api.get<Payment & { refunds: Refund[] }>(merchantPath(merchantId, `/payments/${paymentId}`)),
  });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('requested_by_customer');
  const [done, setDone] = useState<Refund | null>(null);
  const refund = useMutation({
    mutationFn: () =>
      api.post<Refund>(
        merchantPath(merchantId, `/payments/${paymentId}/refunds`),
        { ...(amount.trim() ? { amount: parseAmount(amount, q.data!.settlement_currency) } : {}), reason },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      ),
    onSuccess: (r) => {
      setDone(r);
      setAmount('');
      qc.invalidateQueries({ queryKey: ['merchant', merchantId] });
    },
  });
  if (q.isLoading) return <Card><Spinner /></Card>;
  if (q.error) return <Card><ErrorText>{errorMessage(q.error)}</ErrorText></Card>;
  const p = q.data!;
  const remaining = (BigInt(p.settlement_amount) - BigInt(p.refunded_amount)).toString();
  const st = paymentStatusLabel(t, p.status);

  return (
    <Card title={t('m.payments.detail_title')}>
      <Row label={t('m.payments.payment_id')} value={p.id} mono />
      <Row label="Session" value={p.session_id} mono />
      <Row label={t('common.status')} value={<Badge tone={st.tone}>{st.label}</Badge>} />
      <Row label={t('common.date')} value={formatDate(p.created_at)} />
      <Row label={t('m.payments.order_no')} value={p.order_id ?? '-'} />
      <Row label={t('m.payments.description')} value={p.description ?? '-'} />
      <div className="my-2 border-t border-slate-100" />
      <Row label={t('m.payments.customer_paid')} value={<Amount value={p.source_amount} currency={p.source_currency} code trimZeros className="font-semibold" />} />
      {p.source_currency !== p.settlement_currency && (
        <Row label={t('m.payments.applied_rate')} value={t('m.payments.rate_value', { from: p.source_currency, rate: formatRate(p.fx_rate, 6), to: p.settlement_currency, spread: p.spread_bps / 100 })} />
      )}
      <Row label={t('m.payments.settlement_amount')} value={<Amount value={p.settlement_amount} currency={p.settlement_currency} />} />
      <Row label={t('m.payments.fee_pct', { pct: p.fee_bps / 100 })} value={<Amount value={`-${p.fee_amount}`} currency={p.settlement_currency} />} />
      <Row label={t('m.payments.net_amount')} value={<Amount value={p.net_amount} currency={p.settlement_currency} className="font-semibold" />} />
      <Row label={t('m.payments.refunded')} value={<Amount value={p.refunded_amount} currency={p.settlement_currency} />} />
      {p.refunds.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
          {p.refunds.map((r) => (
            <li key={r.id} className="flex justify-between">
              <span className="font-mono">{r.id}</span>
              <span>
                <Amount value={r.amount} currency={r.currency} /> → <Amount value={r.source_amount} currency={r.source_currency} code symbol={false} trimZeros />
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.status !== 'refunded' && (
        <form
          className="mt-4 space-y-2 border-t border-slate-100 pt-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setDone(null);
            refund.mutate();
          }}
        >
          <p className="text-sm font-semibold">{t('common.refund')}</p>
          <Input
            label={t('m.payments.refund_amount_label', { currency: p.settlement_currency, remaining: minorToDecimalString(remaining, p.settlement_currency) })}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={minorToDecimalString(remaining, p.settlement_currency)}
          />
          <Select label={t('m.payments.reason')} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="requested_by_customer">{t('m.payments.reason.requested_by_customer')}</option>
            <option value="duplicate">{t('m.payments.reason.duplicate')}</option>
            <option value="fraudulent">{t('m.payments.reason.fraudulent')}</option>
            <option value="other">{t('m.payments.reason.other')}</option>
          </Select>
          <p className="text-[11px] text-slate-500">{t('m.payments.refund_note', { currency: p.source_currency })}</p>
          <ErrorText>{refund.error ? errorMessage(refund.error) : null}</ErrorText>
          {done && (
            <SuccessText>
              {t('m.payments.refunded_msg_before')}<Amount value={done.amount} currency={done.currency} />{t('m.payments.refunded_msg_mid')}<Amount value={done.source_amount} currency={done.source_currency} code symbol={false} trimZeros />
            </SuccessText>
          )}
          <Button type="submit" variant="danger" loading={refund.isPending}>
            {t('m.payments.refund_submit')}
          </Button>
        </form>
      )}
    </Card>
  );
}
