import type { Rate } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Amount } from '../../components/Amount';
import { Badge, Button, Card, ErrorText, Spinner, SuccessText, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { journalTypeLabel, systemCodeLabel } from '../../i18n/labels';
import { api, errorMessage } from '../../lib/api';
import { useState } from 'react';

interface Overview {
  counts: Record<string, number>;
  volume_by_currency: { currency: string; count: number; gross: string; fees: string; refunded: string }[];
  user_balances_by_currency: { currency: string; total: string; accounts: number }[];
  merchant_balances_by_currency: { currency: string; total: string; accounts: number }[];
  system_balances: { system_code: string; currency: string; balance: string }[];
  rates: Rate[];
  ledger: { ok: boolean; journal_count: number; line_count: number; unbalanced_journals: unknown[]; negative_accounts: unknown[]; balance_mismatches: unknown[]; checked_at: string };
  recent_journals: { id: string; type: string; created_at: string; lines: { owner: string; currency: string; amount: string }[] }[];
}

/** /admin — 運営の概要: 件数、通貨別残高、システム勘定、台帳検証、直近仕訳 */
export function AdminOverviewPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview'), refetchInterval: 15_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const maintenance = useMutation({
    mutationFn: () => api.post<{ expired_fx_quotes: number; expired_checkout_sessions: number; webhooks: { claimed: number; delivered: number; failed: number } }>('/admin/maintenance/run'),
    onSuccess: (r) => {
      setMsg(t('a.overview.maintenance_done', { quotes: r.expired_fx_quotes, sessions: r.expired_checkout_sessions, claimed: r.webhooks.claimed, delivered: r.webhooks.delivered }));
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorText>{errorMessage(q.error)}</ErrorText>;
  const d = q.data!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{t('a.overview.title')}</h1>
          <p className="text-sm text-slate-400">{t('a.overview.subtitle')}</p>
        </div>
        <Button variant="secondary" loading={maintenance.isPending} onClick={() => maintenance.mutate()}>
          <RefreshCw className="h-4 w-4" /> {t('a.overview.run_maintenance')}
        </Button>
      </div>
      <SuccessText>{msg}</SuccessText>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [t('nav.a.users'), d.counts.users],
          [t('nav.a.merchants'), d.counts.merchants],
          [t('a.overview.count.payments_refunds'), `${d.counts.payments} / ${d.counts.refunds}`],
          [t('a.overview.count.journals'), d.counts.journals],
          [t('a.overview.count.open_sessions'), d.counts.open_sessions],
          [t('a.overview.count.webhook_pending_failed'), `${d.counts.webhook_pending} / ${d.counts.webhook_failed}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl bg-slate-800 p-3 sm:p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-bold tabular sm:text-2xl">{value}</p>
          </div>
        ))}
        <div className={`col-span-2 rounded-2xl p-3 sm:p-4 lg:col-span-1 ${d.ledger.ok ? 'bg-emerald-900/50' : 'bg-rose-900/60'}`}>
          <p className="text-xs text-slate-300">{t('a.overview.ledger_integrity')}</p>
          <p className="mt-1 text-xl font-bold sm:text-2xl">{d.ledger.ok ? t('a.ledger.result_ok') : t('a.ledger.result_ng')}</p>
          <p className="text-[11px] text-slate-400">
            {t('a.ledger.counts', { journals: d.ledger.journal_count, lines: d.ledger.line_count })} · {formatDate(d.ledger.checked_at)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('a.overview.system_balances')}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">{t('a.overview.th_account')}</th>
                  <th>{t('common.currency')}</th>
                  <th className="text-right">{t('common.balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.system_balances.map((s) => (
                  <tr key={`${s.system_code}-${s.currency}`}>
                    <td className="py-1.5 pr-2">
                      {systemCodeLabel(t, s.system_code)}
                      <span className="block font-mono text-[10px] leading-tight text-slate-400">{s.system_code}</span>
                    </td>
                    <td className="pr-2">{s.currency}</td>
                    <td className="text-right">
                      <Amount value={s.balance} currency={s.currency} colored trimZeros />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('a.overview.negative_hint')}</p>
        </Card>
        <div className="space-y-4">
          <Card title={t('a.overview.user_balances')}>
            <ul className="text-sm">
              {d.user_balances_by_currency.map((u) => (
                <li key={u.currency} className="flex justify-between gap-2 py-1">
                  <span>
                    {u.currency} <span className="text-xs text-slate-500">{t('a.overview.accounts_count', { n: u.accounts })}</span>
                  </span>
                  <Amount value={u.total} currency={u.currency} trimZeros />
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('a.overview.merchant_balances')}>
            <ul className="text-sm">
              {d.merchant_balances_by_currency.length === 0 && <li className="text-slate-500">—</li>}
              {d.merchant_balances_by_currency.map((u) => (
                <li key={u.currency} className="flex justify-between gap-2 py-1">
                  <span>
                    {u.currency} <span className="text-xs text-slate-500">{t('a.overview.accounts_count', { n: u.accounts })}</span>
                  </span>
                  <Amount value={u.total} currency={u.currency} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('a.overview.volume')}>
            <ul className="text-sm">
              {d.volume_by_currency.length === 0 && <li className="text-slate-500">—</li>}
              {d.volume_by_currency.map((v) => (
                <li key={v.currency} className="flex items-start justify-between gap-2 py-1">
                  <span className="shrink-0">
                    {v.currency} <span className="text-xs text-slate-500">× {v.count}</span>
                  </span>
                  <span className="text-right">
                    <Amount value={v.gross} currency={v.currency} />
                    <span className="block text-xs text-slate-500">
                      {t('common.fee')} <Amount value={v.fees} currency={v.currency} /> · {t('common.refund')} <Amount value={v.refunded} currency={v.currency} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('common.rate')}>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {d.rates.map((r) => (
              <li key={`${r.base}${r.quote}`} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
                <span className="shrink-0">
                  {r.base}/{r.quote}
                </span>
                <span className="flex items-center gap-1.5 whitespace-nowrap tabular">
                  {Number(r.rate).toLocaleString('ja-JP')} <Badge tone="slate">{r.source}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('a.overview.recent_journals')}>
          <ul className="divide-y divide-slate-100 text-xs">
            {d.recent_journals.map((j) => (
              <li key={j.id} className="py-1.5">
                <p className="font-medium text-slate-800">
                  {journalTypeLabel(t, j.type)} <span className="text-slate-400">{formatDate(j.created_at)}</span>
                </p>
                <p className="break-words text-slate-500">{j.lines.map((l) => `${l.owner}: ${l.amount} ${l.currency}`).join(' / ')}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
