import { CURRENCIES, isCurrencyCode } from '@payccount/shared';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { Card, EmptyState, ErrorText, PageTitle, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import { currencyName } from '../i18n/labels';
import { errorMessage } from '../lib/api';
import { useMe, useTransactions } from '../lib/queries';
import { TransactionRow } from './Home';

/** /wallet/:currency — 通貨別残高・履歴 */
export function WalletPage() {
  const { t, locale } = useI18n();
  const { currency } = useParams();
  if (!currency || !isCurrencyCode(currency)) return <Navigate to="/" replace />;
  const me = useMe();
  const tx = useTransactions({ currency, limit: 50 });
  const def = CURRENCIES[currency];
  const wallet = me.data?.wallets.find((w) => w.currency === currency);

  const actions: { to: string; label: string }[] =
    def.kind === 'fiat' && currency === 'JPY'
      ? [
          { to: '/topup', label: t('u.wallet.action_topup') },
          { to: '/exchange', label: t('u.wallet.action_exchange') },
        ]
      : def.kind === 'fiat'
        ? [{ to: '/exchange', label: t('u.wallet.action_exchange') }]
        : def.kind === 'crypto'
          ? [{ to: '/crypto', label: t('u.wallet.action_crypto') }]
          : [{ to: '/points', label: t('u.wallet.action_points') }];

  return (
    <div className="space-y-4">
      <PageTitle sub={currencyName(locale, currency)}>{currency}</PageTitle>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs text-slate-500">{t('common.balance')}</p>
        {me.isLoading && <Spinner />}
        {wallet && (
          <>
            <p className="mt-1 text-3xl font-bold">
              <Amount value={wallet.balance} currency={currency} trimZeros={def.kind === 'crypto'} />
            </p>
            {currency !== 'JPY' && (
              <p className="text-sm text-slate-500">
                ≈ <Amount value={wallet.jpy_value} currency="JPY" />
                {t('u.wallet.approx_note')}
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
      <Card title={t('u.wallet.history_title', { currency })}>
        {tx.isLoading && <Spinner />}
        {tx.error && <ErrorText>{errorMessage(tx.error)}</ErrorText>}
        {tx.data && tx.data.data.length === 0 && <EmptyState>{t('home.no_tx')}</EmptyState>}
        {tx.data && (
          <ul className="divide-y divide-slate-100">
            {tx.data.data.map((row) => (
              <TransactionRow key={row.id} tx={row} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
