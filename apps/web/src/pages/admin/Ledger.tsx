import type { Page } from '@payccount/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Amount } from '../../components/Amount';
import { Badge, Button, Card, EmptyState, ErrorText, Select, Spinner, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { journalTypeLabel, systemCodeLabel } from '../../i18n/labels';
import { api, errorMessage } from '../../lib/api';

interface AdminJournal {
  id: string;
  type: string;
  created_at: string;
  idempotency_key: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  lines: { account_id: string; owner_type: string; owner: string; currency: string; amount: string }[];
}

interface AdminAccount {
  id: string;
  owner_type: string;
  owner_id: string | null;
  system_code: string | null;
  owner: string;
  currency: string;
  balance: string;
}

interface Verify {
  ok: boolean;
  journal_count: number;
  line_count: number;
  unbalanced_journals: unknown[];
  negative_accounts: unknown[];
  balance_mismatches: unknown[];
  checked_at: string;
}

const TYPES = ['', 'topup_card', 'topup_bank', 'points_purchase', 'fx_convert', 'crypto_buy', 'crypto_sell', 'crypto_deposit', 'crypto_withdrawal', 'payment', 'refund', 'adjustment'];

/** /admin/ledger — 台帳検証、仕訳ブラウザ、全口座 */
export function AdminLedgerPage() {
  const { t } = useI18n();
  const [type, setType] = useState('');
  const verify = useQuery({ queryKey: ['admin', 'verify'], queryFn: () => api.get<Verify>('/admin/ledger/verify') });
  const journals = useInfiniteQuery({
    queryKey: ['admin', 'journals', type],
    queryFn: ({ pageParam }) => {
      const s = new URLSearchParams({ limit: '20' });
      if (type) s.set('type', type);
      if (pageParam) s.set('starting_after', pageParam);
      return api.get<Page<AdminJournal>>(`/admin/journals?${s}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => (last.has_more ? last.data[last.data.length - 1]?.id : undefined),
  });
  const accounts = useQuery({ queryKey: ['admin', 'accounts'], queryFn: () => api.get<{ data: AdminAccount[] }>('/admin/accounts') });
  const items = journals.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('a.ledger.title')}</h1>
      <Card title={t('a.ledger.verify_title')} action={<Button variant="secondary" className="py-1" onClick={() => verify.refetch()}>{t('a.ledger.recheck')}</Button>}>
        {verify.isLoading && <Spinner />}
        {verify.data && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={verify.data.ok ? 'green' : 'red'}>{verify.data.ok ? t('a.ledger.result_ok') : t('a.ledger.result_ng')}</Badge>
            <span>{t('a.ledger.counts', { journals: verify.data.journal_count, lines: verify.data.line_count })}</span>
            <span>{t('a.ledger.unbalanced', { n: verify.data.unbalanced_journals.length })}</span>
            <span>{t('a.ledger.negative', { n: verify.data.negative_accounts.length })}</span>
            <span>{t('a.ledger.mismatch', { n: verify.data.balance_mismatches.length })}</span>
            <span className="text-xs text-slate-500">{formatDate(verify.data.checked_at)}</span>
          </div>
        )}
      </Card>

      <Card title={t('a.ledger.browser')}>
        <div className="mb-3 max-w-xs">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {ty === '' ? t('a.ledger.all_types') : journalTypeLabel(t, ty)}
              </option>
            ))}
          </Select>
        </div>
        {journals.isLoading && <Spinner />}
        {journals.error && <ErrorText>{errorMessage(journals.error)}</ErrorText>}
        {!journals.isLoading && items.length === 0 && <EmptyState>{t('a.ledger.empty')}</EmptyState>}
        <ul className="divide-y divide-slate-100">
          {items.map((j) => (
            <li key={j.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {journalTypeLabel(t, j.type)}
                  {j.reference_type && <span className="ml-2 font-mono text-[10px] text-slate-400">{j.reference_type}:{j.reference_id}</span>}
                </p>
                <p className="text-xs text-slate-500">{formatDate(j.created_at)}</p>
              </div>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i} className="text-slate-700">
                      <td className="w-24 py-0.5">
                        <Badge tone={l.owner_type === 'system' ? 'blue' : l.owner_type === 'merchant' ? 'amber' : 'slate'}>{l.owner_type}</Badge>
                      </td>
                      <td>{l.owner_type === 'system' ? systemCodeLabel(t, l.owner.replace('system:', '')) : l.owner}</td>
                      <td className="text-right">
                        <Amount value={l.amount} currency={l.currency} colored signed symbol={false} code trimZeros />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
        {journals.hasNextPage && (
          <Button variant="secondary" className="mt-3 w-full" loading={journals.isFetchingNextPage} onClick={() => journals.fetchNextPage()}>
            {t('common.load_more')}
          </Button>
        )}
      </Card>

      <Card title={t('a.ledger.all_accounts')}>
        {accounts.isLoading && <Spinner />}
        {accounts.data && (
          <div className="max-h-96 overflow-auto">
            <table className="w-full whitespace-nowrap text-xs [&_td]:pr-3 [&_th]:pr-3">
              <thead className="sticky top-0 bg-white text-left text-slate-500">
                <tr>
                  <th className="py-1">{t('a.ledger.th_type')}</th>
                  <th>{t('a.ledger.th_owner')}</th>
                  <th>{t('common.currency')}</th>
                  <th className="text-right">{t('common.balance')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1">{a.owner_type}</td>
                    <td>{a.owner_type === 'system' ? systemCodeLabel(t, a.system_code ?? '') : a.owner}</td>
                    <td>{a.currency}</td>
                    <td className="text-right">
                      <Amount value={a.balance} currency={a.currency} colored trimZeros />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
