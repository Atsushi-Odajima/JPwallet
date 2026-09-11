import type { Page, Transaction } from '@payccount/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorText, PageTitle, Select, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { JOURNAL_TYPE_LABEL, TransactionRow } from './Home';

const TYPE_OPTIONS = ['', 'topup_card', 'topup_bank', 'points_purchase', 'fx_convert', 'crypto_buy', 'crypto_sell', 'crypto_deposit', 'crypto_withdrawal', 'payment', 'refund'];

/** /history — 統合取引履歴（種別フィルタ・追加読み込み） */
export function HistoryPage() {
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
      <PageTitle sub="すべての残高変動は複式簿記の仕訳として記録されています">取引履歴</PageTitle>
      <Select label="種別で絞り込み" value={type} onChange={(e) => setType(e.target.value)}>
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {t === '' ? 'すべて' : (JOURNAL_TYPE_LABEL[t] ?? t)}
          </option>
        ))}
      </Select>
      <Card>
        {q.isLoading && <Spinner />}
        {q.error && <ErrorText>{errorMessage(q.error)}</ErrorText>}
        {!q.isLoading && items.length === 0 && <EmptyState>取引はまだありません</EmptyState>}
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <TransactionRow key={t.id} tx={t} />
          ))}
        </ul>
        {q.hasNextPage && (
          <Button variant="secondary" className="mt-3 w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            さらに読み込む
          </Button>
        )}
      </Card>
    </div>
  );
}
