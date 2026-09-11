import { CURRENCIES, type Transaction } from '@payccount/shared';
import { ArrowLeftRight, Bitcoin, ChevronRight, Sparkles, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { DemoFooter } from '../components/DemoBanner';
import { Card, EmptyState, ErrorText, Spinner, formatDate } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useMe, useTransactions } from '../lib/queries';

/** 取引種別の表示名 */
export const JOURNAL_TYPE_LABEL: Record<string, string> = {
  topup_card: 'カードチャージ',
  topup_bank: '銀行振込チャージ',
  points_purchase: 'ポイント購入',
  fx_convert: '両替',
  crypto_buy: 'クリプト購入',
  crypto_sell: 'クリプト売却',
  crypto_deposit: 'クリプト入金',
  crypto_withdrawal: 'クリプト出金',
  payment: '決済',
  refund: '返金',
  payout: '出金',
  fee: '手数料',
  adjustment: '調整',
};

export function TransactionRow({ tx }: { tx: Transaction }) {
  const meta = tx.metadata as Record<string, string | undefined>;
  const title = meta.merchant_name ? `${JOURNAL_TYPE_LABEL[tx.type] ?? tx.type}（${meta.merchant_name}）` : (JOURNAL_TYPE_LABEL[tx.type] ?? tx.type);
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">
          {formatDate(tx.created_at)}
          {meta.description ? ` · ${meta.description}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end text-sm">
        {tx.lines.map((l, i) => (
          <Amount key={i} value={l.amount} currency={l.currency} colored signed symbol={false} code className="text-sm" />
        ))}
      </div>
    </li>
  );
}

/** ホーム — 総資産（JPY 換算）、通貨別残高カード、直近取引 */
export function HomePage() {
  const me = useMe();
  const tx = useTransactions({ limit: 5 });

  if (me.isLoading) return <Spinner />;
  if (me.error) return <ErrorText>{errorMessage(me.error)}</ErrorText>;
  const data = me.data!;
  const wallets = data.wallets;
  const nonZero = wallets.filter((w) => w.balance !== '0');
  const shown = nonZero.length > 0 ? wallets.filter((w) => w.balance !== '0' || w.currency === 'JPY') : wallets.filter((w) => w.currency === 'JPY');

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 p-5 text-white shadow-md">
        <p className="text-xs font-medium text-brand-100">総資産（JPY 換算・参考）</p>
        <p className="mt-1 text-3xl font-bold tabular">
          <Amount value={data.total_jpy} currency="JPY" />
        </p>
        <p className="mt-2 text-xs text-brand-100">こんにちは、{data.profile.display_name ?? data.profile.email} さん</p>
        <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
          <Link to="/topup" className="rounded-xl bg-white/15 py-2 hover:bg-white/25">
            <Wallet className="mx-auto mb-1 h-5 w-5" />
            チャージ
          </Link>
          <Link to="/exchange" className="rounded-xl bg-white/15 py-2 hover:bg-white/25">
            <ArrowLeftRight className="mx-auto mb-1 h-5 w-5" />
            両替
          </Link>
          <Link to="/crypto" className="rounded-xl bg-white/15 py-2 hover:bg-white/25">
            <Bitcoin className="mx-auto mb-1 h-5 w-5" />
            クリプト
          </Link>
          <Link to="/points" className="rounded-xl bg-white/15 py-2 hover:bg-white/25">
            <Sparkles className="mx-auto mb-1 h-5 w-5" />
            ポイント
          </Link>
        </div>
      </section>

      <Card title="残高" action={<Link to="/history" className="text-xs text-brand-600">すべての通貨</Link>}>
        <ul className="divide-y divide-slate-100">
          {shown.map((w) => (
            <li key={w.currency}>
              <Link to={`/wallet/${w.currency}`} className="flex items-center justify-between py-2.5 hover:bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                    {CURRENCIES[w.currency].symbol}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{w.currency}</p>
                    <p className="text-xs text-slate-500">{CURRENCIES[w.currency].name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-right">
                  <div>
                    <p className="text-sm font-semibold">
                      <Amount value={w.balance} currency={w.currency} trimZeros={w.kind === 'crypto'} />
                    </p>
                    {w.currency !== 'JPY' && (
                      <p className="text-xs text-slate-500">
                        ≈ <Amount value={w.jpy_value} currency="JPY" />
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {nonZero.length === 0 && <p className="mt-2 text-xs text-slate-500">まずは「チャージ」から JPY をチャージしてみましょう。</p>}
      </Card>

      <Card title="直近の取引" action={<Link to="/history" className="text-xs text-brand-600">すべて見る</Link>}>
        {tx.isLoading && <Spinner />}
        {tx.data && tx.data.data.length === 0 && <EmptyState>取引はまだありません</EmptyState>}
        {tx.data && (
          <ul className="divide-y divide-slate-100">
            {tx.data.data.map((t) => (
              <TransactionRow key={t.id} tx={t} />
            ))}
          </ul>
        )}
      </Card>

      <DemoFooter />
    </div>
  );
}
