import { TEST_CARDS, formatAmount, parseAmount, type Page, type PointCampaign, type PointPurchase, type VirtualBankAccount } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Amount } from '../components/Amount';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorText, Input, PageTitle, Row, Select, Spinner, SuccessText, formatDate } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useInvalidateWallet, useMe } from '../lib/queries';

type Method = 'wallet_jpy' | 'card' | 'bank_transfer';
const PRESETS = ['1000', '3000', '5000', '10000', '30000'];
const METHOD_LABEL: Record<Method, string> = { wallet_jpy: 'JPY 残高', card: '模擬カード', bank_transfer: '模擬銀行振込' };

/** /points — ポイント購入、キャンペーン表示、残高 */
export function PointsPage() {
  const me = useMe();
  const invalidate = useInvalidateWallet();
  const qc = useQueryClient();
  const campaigns = useQuery({ queryKey: ['points', 'campaigns'], queryFn: () => api.get<{ data: PointCampaign[] }>('/me/points/campaigns') });
  const purchases = useQuery({ queryKey: ['points', 'purchases'], queryFn: () => api.get<Page<PointPurchase>>('/me/points/purchases'), refetchInterval: 5_000 });

  const [amount, setAmount] = useState('3000');
  const [method, setMethod] = useState<Method>('wallet_jpy');
  const [number, setNumber] = useState<string>(TEST_CARDS.success);
  const [result, setResult] = useState<PointPurchase | null>(null);

  const buy = useMutation({
    mutationFn: () =>
      api.post<PointPurchase>(
        '/me/points/purchase',
        {
          amount_jpy: parseAmount(amount, 'JPY'),
          method,
          ...(method === 'card' ? { card: { number, exp: '12/30', cvc: '123' } } : {}),
        },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      ),
    onSuccess: (p) => {
      setResult(p);
      invalidate();
      qc.invalidateQueries({ queryKey: ['points', 'purchases'] });
    },
  });

  const pt = me.data?.wallets.find((w) => w.currency === 'PT');
  const jpy = me.data?.wallets.find((w) => w.currency === 'JPY');
  const minor = safeParse(amount);
  const best = minor ? pickBest(campaigns.data?.data ?? [], minor) : null;
  const bonus = best && minor ? (BigInt(minor) * BigInt(Math.round(Number(best.bonus_rate) * 10000))) / 10000n : 0n;

  return (
    <div className="space-y-4">
      <PageTitle sub="1 PT = 1 JPY 相当。加盟店での決済にのみ使えます（両替・出金・クリプト購入は不可）">ポイント</PageTitle>

      <section className="rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 p-5 text-white shadow-md">
        <p className="flex items-center gap-1 text-xs font-medium text-amber-50">
          <Sparkles className="h-3.5 w-3.5" /> ポイント残高
        </p>
        <p className="mt-1 text-3xl font-bold tabular">{pt ? <Amount value={pt.balance} currency="PT" symbol={false} code /> : '-'}</p>
      </section>

      <Card title="キャンペーン">
        {campaigns.isLoading && <Spinner />}
        {campaigns.data && campaigns.data.data.length === 0 && <EmptyState>実施中のキャンペーンはありません</EmptyState>}
        <ul className="space-y-2">
          {campaigns.data?.data.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-amber-900">{c.name}</p>
                <p className="text-xs text-amber-700">
                  {formatAmount(c.min_amount, 'JPY')} 以上 · {formatDate(c.active_to)} まで
                </p>
              </div>
              <Badge tone="amber">+{(Number(c.bonus_rate) * 100).toFixed(1).replace(/\.0$/, '')}%</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="ポイントを購入">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setResult(null);
            buy.mutate();
          }}
        >
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">購入金額（JPY）</span>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p)}
                  className={`rounded-full border px-3 py-1 text-xs ${amount === p ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600'}`}
                >
                  {formatAmount(p, 'JPY')}
                </button>
              ))}
            </div>
            <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Select label="支払方法" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
            <option value="wallet_jpy">JPY 残高から{jpy ? `（残高 ${formatAmount(jpy.balance, 'JPY')}）` : ''}</option>
            <option value="card">模擬カード</option>
            <option value="bank_transfer">模擬銀行振込（入金通知で付与）</option>
          </Select>
          {method === 'card' && (
            <Input
              label="カード番号（テスト）"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              hint={`成功: ${TEST_CARDS.success} / 失敗: ${TEST_CARDS.declined}`}
            />
          )}
          {minor && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <Row label="付与ポイント" value={<span className="font-semibold">{formatAmount((BigInt(minor) + bonus).toString(), 'PT', { symbol: false, code: true })}</span>} />
              {best && <Row label="ボーナス" value={`+${bonus.toString()} PT（${best.name}）`} />}
            </div>
          )}
          <ErrorText>{buy.error ? errorMessage(buy.error) : null}</ErrorText>
          {result && result.status === 'succeeded' && (
            <SuccessText>
              {result.points_granted} PT を付与しました{result.bonus_points !== '0' ? `（ボーナス +${result.bonus_points} PT）` : ''}
            </SuccessText>
          )}
          {result && result.status === 'pending' && (
            <SuccessText>振込識別コード {result.transfer_reference} を発行しました。下の「保留中の振込」から入金をシミュレートできます。</SuccessText>
          )}
          <Button type="submit" className="w-full" loading={buy.isPending}>
            {METHOD_LABEL[method]}で購入
          </Button>
        </form>
      </Card>

      <PendingTransfers purchases={purchases.data?.data ?? []} />

      <Card title="購入履歴">
        {purchases.isLoading && <Spinner />}
        {purchases.data && purchases.data.data.length === 0 && <EmptyState>購入履歴はありません</EmptyState>}
        {purchases.data && purchases.data.data.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {purchases.data.data.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{METHOD_LABEL[p.payment_method]}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(p.created_at)}
                    {p.transfer_reference ? ` · ${p.transfer_reference}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">
                    {p.status === 'succeeded' || p.status === 'pending' ? `${p.points_granted} PT` : '-'}
                    <span className="ml-1 text-xs text-slate-500">/ {formatAmount(p.paid_amount, 'JPY')}</span>
                  </p>
                  <Badge tone={p.status === 'succeeded' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>
                    {p.status === 'succeeded' ? '付与済' : p.status === 'pending' ? '入金待ち' : '失敗'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PendingTransfers({ purchases }: { purchases: PointPurchase[] }) {
  const invalidate = useInvalidateWallet();
  const qc = useQueryClient();
  const pending = purchases.filter((p) => p.status === 'pending' && p.payment_method === 'bank_transfer');
  const va = useQuery({
    queryKey: ['me', 'virtual-account'],
    queryFn: () => api.post<VirtualBankAccount>('/me/topups/bank/virtual-account'),
    enabled: pending.length > 0,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const sim = useMutation({
    mutationFn: (p: PointPurchase) =>
      api.post<{ status: string; point_purchase: PointPurchase | null; note?: string }>('/mock/bank/deposit', {
        account_number: va.data!.account_number,
        amount: p.paid_amount,
        payer_name: `${p.transfer_reference} ヤマダ タロウ`,
        reference: p.transfer_reference,
        external_ref: `SIM-${Date.now()}`,
      }),
    onSuccess: (r) => {
      setMsg(r.point_purchase ? `入金通知を照合し、${r.point_purchase.points_granted} PT を付与しました` : (r.note ?? r.status));
      invalidate();
      qc.invalidateQueries({ queryKey: ['points', 'purchases'] });
    },
  });
  if (pending.length === 0 && !msg) return null;
  return (
    <Card title="保留中の振込（入金待ち）">
      <p className="mb-2 text-xs text-slate-500">
        下記の振込先に、<span className="font-semibold">振込人名の先頭に識別コード</span>を付けて振り込むと、入金通知の照合でポイントが付与されます。
      </p>
      {va.data && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs">
          <Row label="振込先" value={`${va.data.bank_name} ${va.data.branch_name} ${va.data.account_type} ${va.data.account_number}`} />
        </div>
      )}
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <div>
              <p className="flex items-center gap-2 font-mono font-semibold">
                {p.transfer_reference} <CopyButton text={p.transfer_reference ?? ''} />
              </p>
              <p className="text-xs text-slate-600">
                {formatAmount(p.paid_amount, 'JPY')} → {p.points_granted} PT
              </p>
            </div>
            <Button variant="secondary" loading={sim.isPending} disabled={!va.data} onClick={() => sim.mutate(p)}>
              入金をシミュレート
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText>{sim.error ? errorMessage(sim.error) : null}</ErrorText>
      <SuccessText>{msg}</SuccessText>
    </Card>
  );
}

function safeParse(v: string): string | null {
  try {
    const m = parseAmount(v, 'JPY');
    return BigInt(m) > 0n ? m : null;
  } catch {
    return null;
  }
}

function pickBest(campaigns: PointCampaign[], minor: string): PointCampaign | null {
  const amt = BigInt(minor);
  const eligible = campaigns.filter((c) => BigInt(c.min_amount) <= amt);
  if (eligible.length === 0) return null;
  return eligible.sort((a, b) => Number(b.bonus_rate) - Number(a.bonus_rate))[0] ?? null;
}
