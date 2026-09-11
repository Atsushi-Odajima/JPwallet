import { CURRENCIES, isCurrencyCode } from '@payccount/shared';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { Card, EmptyState, ErrorText, PageTitle, Spinner } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useMe, useTransactions } from '../lib/queries';
import { TransactionRow } from './Home';

/** /wallet/:currency — 通貨別残高・履歴 */
export function WalletPage() {
  const { currency } = useParams();
  if (!currency || !isCurrencyCode(currency)) return <Navigate to="/" replace />;
  const me = useMe();
  const tx = useTransactions({ currency, limit: 50 });
  const def = CURRENCIES[currency];
  const wallet = me.data?.wallets.find((w) => w.currency === currency);

  const actions: { to: string; label: string }[] =
    def.kind === 'fiat' && currency === 'JPY'
      ? [
          { to: '/topup', label: 'チャージ' },
          { to: '/exchange', label: '両替' },
        ]
      : def.kind === 'fiat'
        ? [{ to: '/exchange', label: '両替' }]
        : def.kind === 'crypto'
          ? [{ to: '/crypto', label: '売買・入出金' }]
          : [{ to: '/points', label: 'ポイント購入' }];

  return (
    <div className="space-y-4">
      <PageTitle sub={def.name}>{currency}</PageTitle>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs text-slate-500">残高</p>
        {me.isLoading && <Spinner />}
        {wallet && (
          <>
            <p className="mt-1 text-3xl font-bold">
              <Amount value={wallet.balance} currency={currency} trimZeros={def.kind === 'crypto'} />
            </p>
            {currency !== 'JPY' && (
              <p className="text-sm text-slate-500">
                ≈ <Amount value={wallet.jpy_value} currency="JPY" />（参考）
              </p>
            )}
          </>
        )}
        <div className="mt-4 flex gap-2">
          {actions.map((a) => (
            <Link key={a.to} to={a.to} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
              {a.label}
            </Link>
          ))}
        </div>
      </section>
      <Card title={`${currency} の取引履歴`}>
        {tx.isLoading && <Spinner />}
        {tx.error && <ErrorText>{errorMessage(tx.error)}</ErrorText>}
        {tx.data && tx.data.data.length === 0 && <EmptyState>取引はまだありません</EmptyState>}
        {tx.data && (
          <ul className="divide-y divide-slate-100">
            {tx.data.data.map((t) => (
              <TransactionRow key={t.id} tx={t} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
