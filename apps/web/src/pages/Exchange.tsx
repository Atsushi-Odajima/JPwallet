import { CURRENCIES, FIAT_CODES, formatRate, minorToDecimalString, parseAmount, type FxQuote, type Page, type Rate } from '@payccount/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, RefreshCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Amount } from '../components/Amount';
import { Badge, Button, Card, EmptyState, ErrorText, Input, PageTitle, Row, Select, Spinner, formatDate } from '../components/ui';
import { useI18n } from '../i18n';
import { currencyName } from '../i18n/labels';
import { ApiClientError, api, errorMessage } from '../lib/api';
import { useInvalidateWallet, useMe } from '../lib/queries';

/** /exchange — 両替（Quote → 確認 → 実行、残り秒数表示） */
export function ExchangePage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const invalidate = useInvalidateWallet();
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => api.get<{ data: Rate[] }>('/rates'), refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ['me', 'fx-quotes'], queryFn: () => api.get<Page<FxQuote>>('/me/fx/quotes') });

  const [from, setFrom] = useState('JPY');
  const [to, setTo] = useState('USD');
  const [amount, setAmount] = useState('10000');
  const [quote, setQuote] = useState<FxQuote | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [done, setDone] = useState<FxQuote | null>(null);

  // 残り秒数カウントダウン
  useEffect(() => {
    if (!quote || quote.status !== 'open') return;
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [quote]);

  const createQuote = useMutation({
    mutationFn: () =>
      api.post<FxQuote>('/me/fx/quotes', { from_currency: from, to_currency: to, from_amount: parseAmount(amount, from) }),
    onSuccess: (q) => {
      setQuote(q);
      setDone(null);
    },
  });
  const execute = useMutation({
    mutationFn: (id: string) => api.post<FxQuote>(`/me/fx/quotes/${id}/execute`),
    onSuccess: (q) => {
      setDone(q);
      setQuote(null);
      invalidate();
      history.refetch();
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.status === 410) setQuote(null);
    },
  });

  const wallets = me.data?.wallets ?? [];
  const fromWallet = wallets.find((w) => w.currency === from);
  const expired = quote && remaining <= 0;

  return (
    <div className="space-y-4">
      <PageTitle sub={t('u.exchange.sub')}>{t('u.exchange.title')}</PageTitle>

      <Card>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            createQuote.mutate();
          }}
        >
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Input
              label={t('u.exchange.amount')}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={fromWallet ? t('u.exchange.balance_hint', { balance: minorToDecimalString(fromWallet.balance, from), currency: from }) : undefined}
            />
            <Select
              label={t('common.currency')}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value === to) setTo(FIAT_CODES.find((c) => c !== e.target.value)!);
              }}
            >
              {FIAT_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex justify-center text-slate-400">
            <button
              type="button"
              aria-label={t('u.exchange.swap')}
              className="rounded-full border border-slate-200 p-2 hover:bg-slate-50"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
          <Select label={t('u.exchange.to_currency')} value={to} onChange={(e) => setTo(e.target.value)}>
            {FIAT_CODES.filter((c) => c !== from).map((c) => (
              <option key={c} value={c}>
                {c} — {currencyName(locale, c)}
              </option>
            ))}
          </Select>
          <ErrorText>{createQuote.error ? errorMessage(createQuote.error) : null}</ErrorText>
          <Button type="submit" className="w-full" loading={createQuote.isPending}>
            {t('u.exchange.get_quote')}
          </Button>
        </form>
      </Card>

      {quote && (
        <Card
          title={t('u.exchange.quote_title')}
          action={<Badge tone={expired ? 'red' : remaining <= 10 ? 'amber' : 'green'}>{expired ? t('u.exchange.expired') : t('u.exchange.remaining', { n: remaining })}</Badge>}
        >
          <Row label={t('u.exchange.you_pay')} value={<Amount value={quote.from_amount} currency={quote.from_currency} code className="font-semibold" />} />
          <Row label={t('u.exchange.you_receive')} value={<Amount value={quote.to_amount} currency={quote.to_currency} code className="text-lg font-bold text-brand-700" />} />
          <Row label={t('u.exchange.applied_rate')} value={`1 ${quote.from_currency} = ${formatRate(quote.rate, 6)} ${quote.to_currency}`} />
          <Row label={t('u.exchange.mid_rate')} value={t('u.exchange.mid_rate_value', { rate: formatRate(quote.mid_rate, 6), pct: quote.spread_bps / 100 })} />
          <Row label={t('u.exchange.quote_id')} value={quote.id} mono />
          <ErrorText>{execute.error ? errorMessage(execute.error) : null}</ErrorText>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" loading={execute.isPending} disabled={!!expired} onClick={() => execute.mutate(quote.id)}>
              {t('u.exchange.execute')}
            </Button>
            <Button variant="secondary" onClick={() => createQuote.mutate()} loading={createQuote.isPending}>
              <RefreshCw className="h-4 w-4" /> {t('u.exchange.requote')}
            </Button>
          </div>
        </Card>
      )}

      {done && (
        <Card>
          <p className="text-sm font-semibold text-emerald-700">{t('u.exchange.done')}</p>
          <p className="mt-1 text-sm">
            <Amount value={done.from_amount} currency={done.from_currency} code /> → <Amount value={done.to_amount} currency={done.to_currency} code className="font-semibold" />
          </p>
        </Card>
      )}

      <Card title={t('u.exchange.rates_title')}>
        {rates.isLoading && <Spinner />}
        {rates.data && (
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {rates.data.data
              .filter((r) => CURRENCIES[r.base as keyof typeof CURRENCIES]?.kind === 'fiat')
              .map((r) => (
                <li key={`${r.base}${r.quote}`} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">
                    {r.base}/{r.quote}
                  </p>
                  <p className="font-semibold tabular">{formatRate(r.rate, 4)}</p>
                  <p className="text-[10px] text-slate-400">
                    {r.source} · {formatDate(r.fetched_at)}
                  </p>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card title={t('u.exchange.history_title')}>
        {history.data && history.data.data.length === 0 && <EmptyState>{t('u.exchange.no_history')}</EmptyState>}
        {history.data && history.data.data.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.data.data.map((q) => (
              <li key={q.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">
                    {q.from_currency} → {q.to_currency}
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(q.created_at)}</p>
                </div>
                <div className="text-right">
                  <p>
                    <Amount value={q.from_amount} currency={q.from_currency} /> → <Amount value={q.to_amount} currency={q.to_currency} className="font-semibold" />
                  </p>
                  <Badge tone={q.status === 'executed' ? 'green' : q.status === 'expired' ? 'slate' : 'amber'}>
                    {q.status === 'executed' ? t('u.exchange.status.executed') : q.status === 'expired' ? t('u.exchange.expired') : t('u.exchange.status.open')}
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
