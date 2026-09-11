import { formatRate, minorToDecimalString, parseAmount, type Page, type Payment, type Refund } from '@payccount/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Amount } from '../../components/Amount';
import { Badge, Button, Card, EmptyState, ErrorText, Input, PageTitle, Row, Select, Spinner, SuccessText, formatDate } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { merchantPath, useMerchant } from '../../lib/merchant';
import { PAYMENT_STATUS_LABEL } from './Overview';

/** /merchant/payments — 決済一覧・詳細・返金 */
export function MerchantPaymentsPage() {
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
      <PageTitle sub="クリックで詳細と返金">決済</PageTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="mb-3 w-48">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">すべての状態</option>
              <option value="succeeded">成功</option>
              <option value="partially_refunded">一部返金</option>
              <option value="refunded">返金済</option>
            </Select>
          </div>
          {q.isLoading && <Spinner />}
          {!q.isLoading && items.length === 0 && <EmptyState>決済はありません</EmptyState>}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1">日時</th>
                    <th>決済ID</th>
                    <th>注文</th>
                    <th>支払</th>
                    <th className="text-right">精算額</th>
                    <th className="text-right">手数料</th>
                    <th className="text-right">状態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((p) => (
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
                        <Badge tone={PAYMENT_STATUS_LABEL[p.status]?.tone ?? 'slate'}>{PAYMENT_STATUS_LABEL[p.status]?.label ?? p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q.hasNextPage && (
            <Button variant="secondary" className="mt-3 w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
              さらに読み込む
            </Button>
          )}
        </Card>
        <div>{selected ? <PaymentDetail merchantId={merchant.id} paymentId={selected} /> : <Card><EmptyState>決済を選択すると詳細が表示されます</EmptyState></Card>}</div>
      </div>
    </div>
  );
}

function PaymentDetail({ merchantId, paymentId }: { merchantId: string; paymentId: string }) {
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

  return (
    <Card title="決済の詳細">
      <Row label="決済ID" value={p.id} mono />
      <Row label="Session" value={p.session_id} mono />
      <Row label="状態" value={<Badge tone={PAYMENT_STATUS_LABEL[p.status]?.tone ?? 'slate'}>{PAYMENT_STATUS_LABEL[p.status]?.label ?? p.status}</Badge>} />
      <Row label="日時" value={formatDate(p.created_at)} />
      <Row label="注文番号" value={p.order_id ?? '-'} />
      <Row label="説明" value={p.description ?? '-'} />
      <div className="my-2 border-t border-slate-100" />
      <Row label="お客様の支払" value={<Amount value={p.source_amount} currency={p.source_currency} code trimZeros className="font-semibold" />} />
      {p.source_currency !== p.settlement_currency && <Row label="適用レート" value={`1 ${p.source_currency} = ${formatRate(p.fx_rate, 6)} ${p.settlement_currency}（スプレッド ${p.spread_bps / 100}%）`} />}
      <Row label="精算額" value={<Amount value={p.settlement_amount} currency={p.settlement_currency} />} />
      <Row label={`手数料（${p.fee_bps / 100}%）`} value={<Amount value={`-${p.fee_amount}`} currency={p.settlement_currency} />} />
      <Row label="入金額（net）" value={<Amount value={p.net_amount} currency={p.settlement_currency} className="font-semibold" />} />
      <Row label="返金済" value={<Amount value={p.refunded_amount} currency={p.settlement_currency} />} />
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
          <p className="text-sm font-semibold">返金</p>
          <Input label={`返金額（${p.settlement_currency}、空欄で残り全額 ${minorToDecimalString(remaining, p.settlement_currency)}）`} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={minorToDecimalString(remaining, p.settlement_currency)} />
          <Select label="理由" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="requested_by_customer">お客様の依頼</option>
            <option value="duplicate">重複</option>
            <option value="fraudulent">不正</option>
            <option value="other">その他</option>
          </Select>
          <p className="text-[11px] text-slate-500">元の支払通貨（{p.source_currency}）で、決済時のレートの按分で返金されます。手数料は返金されません。</p>
          <ErrorText>{refund.error ? errorMessage(refund.error) : null}</ErrorText>
          {done && (
            <SuccessText>
              返金しました: <Amount value={done.amount} currency={done.currency} /> → お客様へ <Amount value={done.source_amount} currency={done.source_currency} code symbol={false} trimZeros />
            </SuccessText>
          )}
          <Button type="submit" variant="danger" loading={refund.isPending}>
            返金する
          </Button>
        </form>
      )}
    </Card>
  );
}
