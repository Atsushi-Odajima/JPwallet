import type { Rate } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Amount } from '../../components/Amount';
import { Badge, Button, Card, ErrorText, Spinner, SuccessText, formatDate } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { JOURNAL_TYPE_LABEL } from '../Home';
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

export const SYSTEM_CODE_LABEL: Record<string, string> = {
  fx_pool: '為替プール',
  crypto_custody: 'クリプト・カストディ',
  points_issuer: 'ポイント発行元',
  fee_revenue: '手数料収益',
  card_clearing: 'カード清算',
  bank_clearing: '銀行清算',
};

/** /admin — 運営の概要: 件数、通貨別残高、システム勘定、台帳検証、直近仕訳 */
export function AdminOverviewPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.get<Overview>('/admin/overview'), refetchInterval: 15_000 });
  const [msg, setMsg] = useState<string | null>(null);
  const maintenance = useMutation({
    mutationFn: () => api.post<{ expired_fx_quotes: number; expired_checkout_sessions: number; webhooks: { claimed: number; delivered: number; failed: number } }>('/admin/maintenance/run'),
    onSuccess: (r) => {
      setMsg(`保守処理を実行: Quote 期限切れ ${r.expired_fx_quotes} / Session 期限切れ ${r.expired_checkout_sessions} / Webhook 配信 ${r.webhooks.claimed} 件（成功 ${r.webhooks.delivered}）`);
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
          <h1 className="text-xl font-bold">運営ダッシュボード</h1>
          <p className="text-sm text-slate-400">全ユーザー・加盟店・台帳を閲覧できます（管理者: kuro）</p>
        </div>
        <Button variant="secondary" loading={maintenance.isPending} onClick={() => maintenance.mutate()}>
          <RefreshCw className="h-4 w-4" /> Cron 相当の保守処理を実行
        </Button>
      </div>
      <SuccessText>{msg}</SuccessText>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['ユーザー', d.counts.users],
          ['加盟店', d.counts.merchants],
          ['決済 / 返金', `${d.counts.payments} / ${d.counts.refunds}`],
          ['仕訳', d.counts.journals],
          ['未完了 Checkout', d.counts.open_sessions],
          ['Webhook 待ち / 失敗', `${d.counts.webhook_pending} / ${d.counts.webhook_failed}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl bg-slate-800 p-3 sm:p-4">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-bold tabular sm:text-2xl">{value}</p>
          </div>
        ))}
        <div className={`col-span-2 rounded-2xl p-3 sm:p-4 lg:col-span-1 ${d.ledger.ok ? 'bg-emerald-900/50' : 'bg-rose-900/60'}`}>
          <p className="text-xs text-slate-300">台帳整合性</p>
          <p className="mt-1 text-xl font-bold sm:text-2xl">{d.ledger.ok ? 'OK' : 'NG'}</p>
          <p className="text-[11px] text-slate-400">
            {d.ledger.journal_count} 仕訳 / {d.ledger.line_count} 行 · {formatDate(d.ledger.checked_at)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="システム勘定（運営）残高">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">勘定</th>
                  <th>通貨</th>
                  <th className="text-right">残高</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.system_balances.map((s) => (
                  <tr key={`${s.system_code}-${s.currency}`}>
                    <td className="py-1.5 pr-2">
                      {SYSTEM_CODE_LABEL[s.system_code] ?? s.system_code}
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
          <p className="mt-2 text-[11px] text-slate-500">
            負の残高は「発行 / 預かり」を表します（例: points_issuer の PT はユーザーに発行済みのポイント、card_clearing はカード会社からの未収金）。
          </p>
        </Card>
        <div className="space-y-4">
          <Card title="ユーザー残高（通貨別合計）">
            <ul className="text-sm">
              {d.user_balances_by_currency.map((u) => (
                <li key={u.currency} className="flex justify-between gap-2 py-1">
                  <span>
                    {u.currency} <span className="text-xs text-slate-500">× {u.accounts} 口座</span>
                  </span>
                  <Amount value={u.total} currency={u.currency} trimZeros />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="加盟店残高（通貨別合計）">
            <ul className="text-sm">
              {d.merchant_balances_by_currency.length === 0 && <li className="text-slate-500">—</li>}
              {d.merchant_balances_by_currency.map((u) => (
                <li key={u.currency} className="flex justify-between gap-2 py-1">
                  <span>
                    {u.currency} <span className="text-xs text-slate-500">× {u.accounts} 口座</span>
                  </span>
                  <Amount value={u.total} currency={u.currency} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="決済ボリューム（精算通貨別）">
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
                      手数料 <Amount value={v.fees} currency={v.currency} /> · 返金 <Amount value={v.refunded} currency={v.currency} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="レート">
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
        <Card title="直近の仕訳">
          <ul className="divide-y divide-slate-100 text-xs">
            {d.recent_journals.map((j) => (
              <li key={j.id} className="py-1.5">
                <p className="font-medium text-slate-800">
                  {JOURNAL_TYPE_LABEL[j.type] ?? j.type} <span className="text-slate-400">{formatDate(j.created_at)}</span>
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
