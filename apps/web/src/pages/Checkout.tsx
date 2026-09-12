import { CURRENCIES, formatAmount, formatRate, type CheckoutView, type Payment } from '@payccount/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, ShieldCheck, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { Badge, Button, Card, ErrorText, Row, Spinner, formatDate } from '../components/ui';
import { LocaleSwitch, useI18n } from '../i18n';
import { currencyName } from '../i18n/labels';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useInvalidateWallet } from '../lib/queries';

interface ConfirmResult {
  payment: Payment;
  redirect_url: string;
}

/** /checkout/:sessionId — 加盟店決済ページ */
export function CheckoutPage() {
  const { sessionId } = useParams();
  const { session } = useAuth();
  const { t } = useI18n();
  const invalidate = useInvalidateWallet();
  const view = useQuery({
    queryKey: ['checkout', sessionId],
    queryFn: () => api.get<CheckoutView>(`/me/checkout/sessions/${sessionId}`),
    enabled: !!session && !!sessionId,
    refetchInterval: (q) => (q.state.data?.session.status === 'open' ? 15_000 : false),
  });
  const [source, setSource] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [countdown, setCountdown] = useState(5);

  const confirm = useMutation({
    mutationFn: () => api.post<ConfirmResult>(`/me/checkout/sessions/${sessionId}/confirm`, { source_currency: source }),
    onSuccess: (r) => {
      setResult(r);
      invalidate();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.post<{ redirect_url: string }>(`/me/checkout/sessions/${sessionId}/cancel`),
    onSuccess: (r) => {
      window.location.assign(r.redirect_url);
    },
  });

  // 支払完了後に success_url へ自動リダイレクト
  useEffect(() => {
    if (!result) return;
    if (countdown <= 0) {
      window.location.assign(result.redirect_url);
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [result, countdown]);

  // 最初に十分な残高があるソースを選ぶ
  useEffect(() => {
    if (view.data && source === null) {
      const first = view.data.sources.find((s) => s.sufficient) ?? view.data.sources[0];
      if (first) setSource(first.currency);
    }
  }, [view.data, source]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2 px-4 py-3">
          <span className="flex items-center gap-2 font-bold text-brand-800">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" /> payCcount
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-emerald-500" /> {t('checkout.secure')}
            </span>
            <LocaleSwitch />
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-lg flex-1 px-4 py-6">
        {view.isLoading && <Spinner />}
        {view.error && <ErrorText>{errorMessage(view.error)}</ErrorText>}
        {view.data && !result && <CheckoutBody view={view.data} source={source} setSource={setSource} onPay={() => confirm.mutate()} paying={confirm.isPending} payError={confirm.error} onCancel={() => cancel.mutate()} canceling={cancel.isPending} />}
        {result && (
          <Card>
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="mt-2 text-xl font-bold">{t('checkout.paid_title')}</h1>
              <p className="mt-1 text-sm text-slate-500">{t('checkout.redirecting', { n: countdown })}</p>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <Row label={t('checkout.paid_amount')} value={<Amount value={result.payment.source_amount} currency={result.payment.source_currency} code className="font-semibold" trimZeros />} />
              <Row label={t('checkout.merchant_receives')} value={<Amount value={result.payment.settlement_amount} currency={result.payment.settlement_currency} code />} />
              {result.payment.source_currency !== result.payment.settlement_currency && (
                <Row label={t('checkout.applied_rate')} value={`1 ${result.payment.source_currency} = ${formatRate(result.payment.fx_rate, 6)} ${result.payment.settlement_currency}`} />
              )}
              <Row label={t('checkout.payment_id')} value={result.payment.id} mono />
            </div>
            <a href={result.redirect_url} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
              {t('checkout.back_to_shop')} <ExternalLink className="h-4 w-4" />
            </a>
          </Card>
        )}
      </main>
    </div>
  );
}

function CheckoutBody({
  view,
  source,
  setSource,
  onPay,
  paying,
  payError,
  onCancel,
  canceling,
}: {
  view: CheckoutView;
  source: string | null;
  setSource: (s: string) => void;
  onPay: () => void;
  paying: boolean;
  payError: unknown;
  onCancel: () => void;
  canceling: boolean;
}) {
  const { t, locale } = useI18n();
  const s = view.session;
  const selected = view.sources.find((x) => x.currency === source);

  if (s.status !== 'open') {
    return (
      <Card>
        <div className="text-center">
          <Badge tone={s.status === 'completed' ? 'green' : 'slate'}>
            {s.status === 'completed' ? t('checkout.status_completed') : s.status === 'expired' ? t('checkout.status_expired') : t('checkout.status_canceled')}
          </Badge>
          <p className="mt-3 text-sm text-slate-600">
            {s.status === 'completed' && view.payment
              ? view.is_payer
                ? t('checkout.already_paid_self')
                : t('checkout.already_paid_other')
              : s.status === 'expired'
                ? t('checkout.expired_msg')
                : t('checkout.canceled_msg')}
          </p>
          {s.status === 'completed' && view.payment && view.is_payer && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-left text-sm">
              <Row label={t('checkout.paid_amount')} value={<Amount value={view.payment.source_amount} currency={view.payment.source_currency} code trimZeros />} />
              <Row label={t('checkout.payment_id')} value={view.payment.id} mono />
            </div>
          )}
          <a href={s.status === 'completed' ? s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) : s.cancel_url} className="mt-4 inline-block text-sm font-medium text-brand-600 underline">
            {t('checkout.back_to_shop')}
          </a>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Store className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">{t('checkout.pay_to')}</p>
            <p className="truncate text-lg font-bold">{view.merchant.name}</p>
            {view.merchant.website_url && <p className="truncate text-xs text-slate-400">{view.merchant.website_url}</p>}
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">{t('checkout.amount_due', { currency: s.currency })}</p>
          <p className="text-3xl font-bold tabular">
            <Amount value={s.amount} currency={s.currency} />
          </p>
          {s.description && <p className="mt-1 text-sm text-slate-700">{s.description}</p>}
          {s.order_id && <p className="text-xs text-slate-500">{t('checkout.order_no', { id: s.order_id })}</p>}
        </div>
        <p className="mt-2 text-right text-[11px] text-slate-400">{t('checkout.expires', { date: formatDate(s.expires_at) })}</p>
      </Card>

      <Card title={t('checkout.methods')}>
        <ul className="space-y-2">
          {view.sources.map((src) => {
            const def = CURRENCIES[src.currency];
            const active = source === src.currency;
            return (
              <li key={src.currency}>
                <button
                  type="button"
                  disabled={!src.sufficient}
                  onClick={() => setSource(src.currency)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                    active ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'
                  } ${src.sufficient ? 'hover:border-brand-300' : 'cursor-not-allowed opacity-50'}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${active ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-700'}`}>{def.symbol}</span>
                    <div>
                      <p className="text-sm font-semibold">
                        {src.currency} <span className="text-xs font-normal text-slate-500">{currencyName(locale, src.currency)}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {t('checkout.balance')} <Amount value={src.balance} currency={src.currency} trimZeros />
                        {!src.sufficient && <span className="ml-1 text-rose-600">（{t('common.insufficient')}）</span>}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">
                      <Amount value={src.amount} currency={src.currency} trimZeros />
                    </p>
                    {src.currency !== s.currency && (
                      <p className="text-[10px] text-slate-500">
                        1 {src.currency} = {formatRate(src.rate, src.currency === 'BTC' || src.currency === 'ETH' ? 2 : 6)} {s.currency}
                        {src.spread_bps > 0 ? t('checkout.spread_note', { pct: src.spread_bps / 100 }) : ''}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        {view.sources.every((x) => !x.sufficient) && (
          <p className="mt-3 text-xs text-rose-600">
            {t('checkout.insufficient_all_before')}
            <Link to="/topup" className="underline">
              {t('checkout.insufficient_all_link')}
            </Link>
            {t('checkout.insufficient_all_after')}
          </p>
        )}
      </Card>

      <ErrorText>{payError ? errorMessage(payError) : null}</ErrorText>
      <Button className="w-full py-3 text-base" disabled={!selected || !selected.sufficient} loading={paying} onClick={onPay}>
        {selected ? t('checkout.pay_amount', { amount: formatAmount(selected.amount, selected.currency, { trimZeros: true }) }) : t('checkout.pay')}
      </Button>
      <button type="button" className="w-full text-center text-sm text-slate-500 underline" onClick={onCancel} disabled={canceling}>
        {t('checkout.cancel')}
      </button>
    </div>
  );
}
