import { CURRENCIES, formatRate, type CheckoutView, type Payment } from '@payccount/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, ShieldCheck, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Amount } from '../components/Amount';
import { DemoBanner } from '../components/DemoBanner';
import { Badge, Button, Card, ErrorText, Row, Spinner, formatDate } from '../components/ui';
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
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
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
      <DemoBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 font-bold text-brand-800">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" /> payCcount
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-500" /> 安全なデモ決済
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
              <h1 className="mt-2 text-xl font-bold">支払いが完了しました</h1>
              <p className="mt-1 text-sm text-slate-500">{countdown} 秒後にショップへ戻ります</p>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <Row label="支払額" value={<Amount value={result.payment.source_amount} currency={result.payment.source_currency} code className="font-semibold" trimZeros />} />
              <Row label="加盟店受取" value={<Amount value={result.payment.settlement_amount} currency={result.payment.settlement_currency} code />} />
              {result.payment.source_currency !== result.payment.settlement_currency && (
                <Row label="適用レート" value={`1 ${result.payment.source_currency} = ${formatRate(result.payment.fx_rate, 6)} ${result.payment.settlement_currency}`} />
              )}
              <Row label="決済ID" value={result.payment.id} mono />
            </div>
            <a href={result.redirect_url} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600">
              ショップに戻る <ExternalLink className="h-4 w-4" />
            </a>
          </Card>
        )}
      </main>
      <footer className="px-4 py-4 text-center text-xs text-slate-500">これはデモアプリケーションです。実際の資金は移動しません。</footer>
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
  const s = view.session;
  const selected = view.sources.find((x) => x.currency === source);

  if (s.status !== 'open') {
    return (
      <Card>
        <div className="text-center">
          <Badge tone={s.status === 'completed' ? 'green' : 'slate'}>{s.status === 'completed' ? '決済済み' : s.status === 'expired' ? '期限切れ' : 'キャンセル済み'}</Badge>
          <p className="mt-3 text-sm text-slate-600">
            {s.status === 'completed' && view.payment
              ? view.is_payer
                ? 'この Checkout はすでにお支払いが完了しています。'
                : 'この Checkout は別のユーザーによって決済されています。'
              : s.status === 'expired'
                ? 'この Checkout の有効期限が切れました。ショップに戻ってやり直してください。'
                : 'この Checkout はキャンセルされました。'}
          </p>
          {s.status === 'completed' && view.payment && view.is_payer && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-left text-sm">
              <Row label="支払額" value={<Amount value={view.payment.source_amount} currency={view.payment.source_currency} code trimZeros />} />
              <Row label="決済ID" value={view.payment.id} mono />
            </div>
          )}
          <a href={s.status === 'completed' ? s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) : s.cancel_url} className="mt-4 inline-block text-sm font-medium text-brand-600 underline">
            ショップに戻る
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
            <p className="text-xs text-slate-500">お支払い先</p>
            <p className="truncate text-lg font-bold">{view.merchant.name}</p>
            {view.merchant.website_url && <p className="truncate text-xs text-slate-400">{view.merchant.website_url}</p>}
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <p className="text-xs text-slate-500">請求金額（{s.currency}）</p>
          <p className="text-3xl font-bold tabular">
            <Amount value={s.amount} currency={s.currency} />
          </p>
          {s.description && <p className="mt-1 text-sm text-slate-700">{s.description}</p>}
          {s.order_id && <p className="text-xs text-slate-500">注文番号: {s.order_id}</p>}
        </div>
        <p className="mt-2 text-right text-[11px] text-slate-400">有効期限 {formatDate(s.expires_at)}</p>
      </Card>

      <Card title="お支払い方法（残高）">
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
                        {src.currency} <span className="text-xs font-normal text-slate-500">{def.name}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        残高 <Amount value={src.balance} currency={src.currency} trimZeros />
                        {!src.sufficient && <span className="ml-1 text-rose-600">（不足）</span>}
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
                        {src.spread_bps > 0 ? `（スプレッド ${src.spread_bps / 100}%）` : ''}
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
            残高が不足しています。<Link to="/topup" className="underline">チャージ</Link>してから戻ってきてください（このページの URL は有効期限内であれば再度開けます）。
          </p>
        )}
      </Card>

      <ErrorText>{payError ? errorMessage(payError) : null}</ErrorText>
      <Button className="w-full py-3 text-base" disabled={!selected || !selected.sufficient} loading={paying} onClick={onPay}>
        {selected ? (
          <>
            <Amount value={selected.amount} currency={selected.currency} trimZeros /> を支払う
          </>
        ) : (
          '支払う'
        )}
      </Button>
      <button type="button" className="w-full text-center text-sm text-slate-500 underline" onClick={onCancel} disabled={canceling}>
        キャンセルしてショップに戻る
      </button>
    </div>
  );
}
