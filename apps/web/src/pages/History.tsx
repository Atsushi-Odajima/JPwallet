import type { Page, Transaction } from '@payccount/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorText, PageTitle, Select, Spinner } from '../components/ui';
import { useI18n } from '../i18n';
import { journalTypeLabel } from '../i18n/labels';
import { api, errorMessage } from '../lib/api';
import { TransactionRow } from './Home';

const TYPE_OPTIONS = ['', 'topup_card', 'topup_bank', 'points_purchase', 'fx_convert', 'crypto_buy', 'crypto_sell', 'crypto_deposit', 'crypto_withdrawal', 'payment', 'refund'];

/** /history — 統合取引履歴（種別フィルタ・追加読み込み） */
export function HistoryPage() {
  const { t } = useI18n();
  const [type, setType] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['me', 'transactions', 'infinite', type],
    queryFn: ({ pageParam }) => {
      const s = new URLSearchParams({ limit: '20' });
      if (type) s.set('type', type);
      if (pageParam) s.set('starting_after', pageParam);
      return api.get<Page<Transaction>>(`/me/transactions?${s.toString()}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => (last.has_more ? last.data[last.data.length - 1]?.id : undefined),
  });

  const items = q.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-4">
      <PageTitle sub={t('u.history.sub')}>{t('u.history.title')}</PageTitle>
      <Select label={t('u.history.filter')} value={type} onChange={(e) => setType(e.target.value)}>
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt === '' ? t('common.all') : journalTypeLabel(t, opt)}
          </option>
        ))}
      </Select>
      <Card>
        {q.isLoading && <Spinner />}
        {q.error && <ErrorText>{errorMessage(q.error)}</ErrorText>}
        {!q.isLoading && items.length === 0 && <EmptyState>{t('home.no_tx')}</EmptyState>}
        <ul className="divide-y divide-slate-100">
          {items.map((row) => (
            <TransactionRow key={row.id} tx={row} />
          ))}
        </ul>
        {q.hasNextPage && (
          <Button variant="secondary" className="mt-3 w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {t('common.load_more')}
          </Button>
        )}
      </Card>
    </div>
  );
}
