import type { Balance, Merchant, Payment } from '@payccount/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Amount } from '../../components/Amount';
import { Badge, Card, EmptyState, ErrorText, PageTitle, Spinner, formatDate } from '../../components/ui';
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

export const PAYMENT_STATUS_LABEL: Record<string, { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  succeeded: { label: '成功', tone: 'green' },
  partially_refunded: { label: '一部返金', tone: 'amber' },
  refunded: { label: '返金済', tone: 'slate' },
};

/** /merchant — 売上サマリ、残高（精算通貨）、直近決済 */
export function MerchantOverviewPage() {
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
      <PageTitle sub={`${merchant.name} · 精算通貨 ${cur} · 決済手数料 ${merchant.fee_bps / 100}%`}>概要</PageTitle>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="売上残高（利用可能）" value={<Amount value={available} currency={cur} />} accent />
        <Stat label="総売上（手数料込み）" value={<Amount value={d.stats.gross_volume} currency={cur} />} sub={`本日 ${fmt(d.stats.gross_volume_today, cur)}`} />
        <Stat label="決済件数" value={String(d.stats.payments_count)} sub={`本日 ${d.stats.payments_today} 件`} />
        <Stat label="手数料 / 返金" value={<Amount value={d.stats.fees_total} currency={cur} />} sub={`返金 ${fmt(d.stats.refunded_total, cur)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="直近の決済" className="lg:col-span-2" action={<Link to="/merchant/payments" className="text-xs text-brand-600">すべて見る</Link>}>
          {d.recent_payments.length === 0 && <EmptyState>決済はまだありません。「開発者」で APIキーを発行し、Checkout Session を作成してください。</EmptyState>}
          {d.recent_payments.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">日時</th>
                  <th>注文</th>
                  <th>支払</th>
                  <th className="text-right">精算額</th>
                  <th className="text-right">状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.recent_payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 text-xs text-slate-500">{formatDate(p.created_at)}</td>
                    <td className="truncate">{p.order_id ?? p.description ?? '-'}</td>
                    <td className="text-xs">
                      <Amount value={p.source_amount} currency={p.source_currency} code symbol={false} trimZeros />
                    </td>
                    <td className="text-right font-medium">
                      <Amount value={p.settlement_amount} currency={p.settlement_currency} />
                    </td>
                    <td className="text-right">
                      <Badge tone={PAYMENT_STATUS_LABEL[p.status]?.tone ?? 'slate'}>{PAYMENT_STATUS_LABEL[p.status]?.label ?? p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="支払ソース別">
            {d.by_source.length === 0 && <EmptyState>データなし</EmptyState>}
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
          <Card title="連携状態">
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between">
                <span>有効な APIキー</span>
                <span className="font-medium">{d.stats.api_keys_active}</span>
              </li>
              <li className="flex justify-between">
                <span>Webhook エンドポイント</span>
                <span className="font-medium">{d.stats.webhook_endpoints}</span>
              </li>
              <li className="flex justify-between">
                <span>配信失敗</span>
                <span className={`font-medium ${d.stats.webhook_failed > 0 ? 'text-rose-600' : ''}`}>{d.stats.webhook_failed}</span>
              </li>
              <li className="flex justify-between">
                <span>未完了の Checkout</span>
                <span className="font-medium">{d.stats.open_sessions}</span>
              </li>
            </ul>
            <Link to="/merchant/developers" className="mt-3 inline-block text-xs text-brand-600 underline">
              開発者ページへ →
            </Link>
          </Card>
        </div>
      </div>

      <Card title="はじめかた">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
          <li>
            <Link to="/merchant/developers" className="text-brand-600 underline">開発者</Link>で APIキー（sk_test_…）を発行し、Webhook エンドポイントを登録する
          </li>
          <li>
            サーバーから <code className="rounded bg-slate-100 px-1">POST /v1/checkout/sessions</code> を呼び、返ってきた <code className="rounded bg-slate-100 px-1">url</code> にお客様をリダイレクトする
          </li>
          <li>
            お客様が payCcount で支払うと <code className="rounded bg-slate-100 px-1">payment.succeeded</code> Webhook が届き、売上残高が {cur} で増える
          </li>
          <li>返金は「決済」ページまたは API から。元の支払通貨で決済時レートのまま戻る</li>
        </ol>
        <Link to="/merchant/docs" className="mt-2 inline-block text-xs text-brand-600 underline">
          統合ガイド・SDK スニペット →
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
