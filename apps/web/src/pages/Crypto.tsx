import { formatAmount, formatRate, minorToDecimalString, parseAmount, type CryptoDeposit, type CryptoDepositAddress, type CryptoOrder, type CryptoPrices, type CryptoWithdrawal, type Page } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Amount } from '../components/Amount';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorText, Input, PageTitle, Row, Select, Spinner, SuccessText, formatDate } from '../components/ui';
import { useI18n } from '../i18n';
import { currencyName } from '../i18n/labels';
import { api, errorMessage } from '../lib/api';
import { useInvalidateWallet, useMe } from '../lib/queries';

type Asset = 'BTC' | 'ETH';

/** /crypto — 価格、購入・売却、入金アドレス、出金（すべて模擬） */
export function CryptoPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const prices = useQuery({ queryKey: ['crypto', 'prices'], queryFn: () => api.get<CryptoPrices>('/crypto/prices'), refetchInterval: 15_000 });
  const [asset, setAsset] = useState<Asset>('BTC');

  return (
    <div className="space-y-4">
      <PageTitle sub={t('u.crypto.sub')}>{t('u.crypto.title')}</PageTitle>

      <div className="grid grid-cols-2 gap-2">
        {(['BTC', 'ETH'] as Asset[]).map((a) => {
          const w = me.data?.wallets.find((x) => x.currency === a);
          const d = prices.data?.detail[a];
          return (
            <button
              key={a}
              type="button"
              onClick={() => setAsset(a)}
              className={`rounded-2xl border p-4 text-left shadow-sm transition ${asset === a ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'}`}
            >
              <p className="text-xs text-slate-500">{currencyName(locale, a)}</p>
              <p className="text-lg font-bold">{a}</p>
              {d && <p className="text-sm tabular text-slate-700">¥{formatRate(d.mid, 0)}</p>}
              {d && <p className="text-[10px] text-slate-500">{t('u.crypto.buy_sell_price', { buy: formatRate(d.buy, 0), sell: formatRate(d.sell, 0) })}</p>}
              {w && (
                <p className="mt-1 text-xs font-medium text-brand-700">
                  {t('u.crypto.holding')}
                  <Amount value={w.balance} currency={a} symbol={false} trimZeros /> ≈ <Amount value={w.jpy_value} currency="JPY" />
                </p>
              )}
            </button>
          );
        })}
      </div>

      <TradeCard asset={asset} prices={prices.data} />
      <DepositCard asset={asset} />
      <WithdrawCard asset={asset} />
      <OrdersCard />
    </div>
  );
}

function TradeCard({ asset, prices }: { asset: Asset; prices?: CryptoPrices }) {
  const { t } = useI18n();
  const invalidate = useInvalidateWallet();
  const qc = useQueryClient();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [mode, setMode] = useState<'quote' | 'asset'>('quote');
  const [amount, setAmount] = useState('10000');
  const [result, setResult] = useState<CryptoOrder | null>(null);

  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = { side, asset, quote_currency: 'JPY' };
      if (mode === 'quote') body.quote_amount = parseAmount(amount, 'JPY');
      else body.asset_amount = parseAmount(amount, asset);
      return api.post<CryptoOrder>('/me/crypto/orders', body);
    },
    onSuccess: (o) => {
      setResult(o);
      invalidate();
      qc.invalidateQueries({ queryKey: ['crypto', 'orders'] });
    },
  });

  const price = prices?.detail[asset];
  return (
    <Card title={side === 'buy' ? t('u.crypto.trade_title_buy', { asset }) : t('u.crypto.trade_title_sell', { asset })}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setResult(null);
          m.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
          <button type="button" className={`rounded-lg py-1.5 ${side === 'buy' ? 'bg-white shadow text-emerald-700' : 'text-slate-500'}`} onClick={() => setSide('buy')}>
            {t('u.crypto.buy')}
          </button>
          <button type="button" className={`rounded-lg py-1.5 ${side === 'sell' ? 'bg-white shadow text-rose-700' : 'text-slate-500'}`} onClick={() => setSide('sell')}>
            {t('u.crypto.sell')}
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Input label={mode === 'quote' ? t('u.crypto.amount_jpy') : t('u.crypto.quantity', { asset })} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select
            label={t('u.crypto.specify')}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as 'quote' | 'asset');
              setAmount(e.target.value === 'quote' ? '10000' : asset === 'BTC' ? '0.001' : '0.01');
            }}
          >
            <option value="quote">JPY</option>
            <option value="asset">{asset}</option>
          </Select>
        </div>
        {price && (
          <p className="text-xs text-slate-500">
            {t('u.crypto.applied_price', { asset, price: formatRate(side === 'buy' ? price.buy : price.sell, 0), pct: (prices?.spread_bps ?? 0) / 100 })}
          </p>
        )}
        <ErrorText>{m.error ? errorMessage(m.error) : null}</ErrorText>
        {result && (
          <SuccessText>
            {result.side === 'buy' ? t('u.crypto.bought') : t('u.crypto.sold')}
            <Amount value={result.asset_amount} currency={result.asset} symbol={false} code trimZeros /> ⇄{' '}
            <Amount value={result.quote_amount} currency="JPY" />
          </SuccessText>
        )}
        <Button type="submit" className="w-full" loading={m.isPending} variant={side === 'buy' ? 'primary' : 'danger'}>
          {side === 'buy' ? t('u.crypto.buy_submit') : t('u.crypto.sell_submit')}
        </Button>
      </form>
    </Card>
  );
}

function DepositCard({ asset }: { asset: Asset }) {
  const { t } = useI18n();
  const invalidate = useInvalidateWallet();
  const qc = useQueryClient();
  const addr = useQuery({ queryKey: ['crypto', 'deposit-address', asset], queryFn: () => api.get<CryptoDepositAddress>(`/me/crypto/deposit-address?asset=${asset}`) });
  const deposits = useQuery({ queryKey: ['crypto', 'deposits'], queryFn: () => api.get<Page<CryptoDeposit>>('/me/crypto/deposits') });
  const [amount, setAmount] = useState(asset === 'BTC' ? '0.01' : '0.5');
  const [msg, setMsg] = useState<string | null>(null);
  const sim = useMutation({
    mutationFn: () => api.post<{ status: string }>('/mock/crypto/deposit', { asset, to_address: addr.data!.address, amount: parseAmount(amount, asset) }),
    onSuccess: (r) => {
      setMsg(r.status === 'processed' ? t('u.crypto.deposit_confirmed') : r.status);
      invalidate();
      qc.invalidateQueries({ queryKey: ['crypto', 'deposits'] });
    },
  });
  return (
    <Card title={t('u.crypto.deposit_title', { asset })}>
      {addr.isLoading && <Spinner />}
      {addr.data && (
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3">
          <code className="flex-1 break-all text-xs">{addr.data.address}</code>
          <CopyButton text={addr.data.address} />
        </div>
      )}
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setMsg(null);
          sim.mutate();
        }}
      >
        <Input label={t('u.crypto.simulate_deposit', { asset })} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button type="submit" variant="secondary" loading={sim.isPending} disabled={!addr.data}>
          {t('u.crypto.deposit_submit')}
        </Button>
      </form>
      <ErrorText>{sim.error ? errorMessage(sim.error) : null}</ErrorText>
      <SuccessText>{msg}</SuccessText>
      {deposits.data && deposits.data.data.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {deposits.data.data.slice(0, 5).map((d) => (
            <li key={d.id} className="flex justify-between py-1.5">
              <span className="truncate font-mono text-slate-500">{d.fake_tx_hash.slice(0, 18)}…</span>
              <Amount value={d.amount} currency={d.asset} symbol={false} code trimZeros className="font-semibold" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WithdrawCard({ asset }: { asset: Asset }) {
  const { t } = useI18n();
  const invalidate = useInvalidateWallet();
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<CryptoWithdrawal | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<CryptoWithdrawal>('/me/crypto/withdrawals', { asset, amount: parseAmount(amount, asset), to_address: address }),
    onSuccess: (w) => {
      setResult(w);
      invalidate();
    },
  });
  return (
    <Card title={t('u.crypto.withdraw_title', { asset })}>
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setResult(null);
          m.mutate();
        }}
      >
        <Input label={t('u.crypto.to_address')} placeholder={asset === 'BTC' ? 'bc1q...' : '0x...'} value={address} onChange={(e) => setAddress(e.target.value)} />
        <Input label={t('u.crypto.quantity', { asset })} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <ErrorText>{m.error ? errorMessage(m.error) : null}</ErrorText>
        {result && (
          <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
            <p className="font-semibold">{t('u.crypto.sent')}</p>
            <Row label="TX Hash" value={result.fake_tx_hash} mono />
          </div>
        )}
        <Button type="submit" variant="secondary" className="w-full" loading={m.isPending}>
          {t('u.crypto.withdraw_submit')}
        </Button>
        <p className="text-[10px] text-slate-400">{t('u.crypto.withdraw_note')}</p>
      </form>
    </Card>
  );
}

function OrdersCard() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['crypto', 'orders'], queryFn: () => api.get<Page<CryptoOrder>>('/me/crypto/orders') });
  return (
    <Card title={t('u.crypto.orders_title')}>
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>{t('u.crypto.no_orders')}</EmptyState>}
      {q.data && q.data.data.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.data.map((o) => (
            <li key={o.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">
                  <Badge tone={o.side === 'buy' ? 'green' : 'red'}>{o.side === 'buy' ? t('u.crypto.buy') : t('u.crypto.sell')}</Badge> {o.asset}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDate(o.created_at)} · @¥{formatRate(o.price, 0)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{minorToDecimalString(o.asset_amount, o.asset)} {o.asset}</p>
                <p className="text-xs text-slate-500">{formatAmount(o.quote_amount, 'JPY')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
