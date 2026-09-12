import type { Me, Merchant, Transaction } from '@payccount/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Amount } from '../../components/Amount';
import { Badge, Card, EmptyState, ErrorText, Input, Row, Spinner, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { TransactionRow } from '../Home';

interface AdminUser {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: 'user' | 'admin';
  country: string;
  created_at: string;
  balances: Record<string, string>;
  total_jpy: string;
  merchants: number;
  payments: number;
}

interface AdminUserDetail {
  me: Me;
  transactions: Transaction[];
  merchants: Merchant[];
  virtual_bank_account: { bank_name: string; branch_code: string; account_number: string; holder_name: string } | null;
}

/** /admin/users — 全ユーザーと残高、詳細 */
export function AdminUsersPage() {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin', 'users', search],
    queryFn: () => api.get<{ data: AdminUser[] }>(`/admin/users?limit=200${search ? `&q=${encodeURIComponent(search)}` : ''}`),
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('a.users.title')}</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <Card>
          <div className="mb-3 max-w-xs">
            <Input placeholder={t('a.users.search_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {q.isLoading && <Spinner />}
          {q.error && <ErrorText>{errorMessage(q.error)}</ErrorText>}
          {q.data && q.data.data.length === 0 && <EmptyState>{t('a.users.empty')}</EmptyState>}
          {q.data && q.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">{t('common.user')}</th>
                    <th className="pr-3">{t('a.users.th_role')}</th>
                    <th className="pr-3">{t('common.balance')}</th>
                    <th className="pr-3 text-right">{t('a.users.th_jpy_equiv')}</th>
                    <th className="text-right">{t('a.users.th_merchants_payments')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.data.map((u) => (
                    <tr key={u.user_id} className={`cursor-pointer hover:bg-slate-50 ${selected === u.user_id ? 'bg-brand-50' : ''}`} onClick={() => setSelected(u.user_id)}>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{u.display_name ?? '-'}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="pr-3">{u.role === 'admin' ? <Badge tone="red">{t('common.admin')}</Badge> : <Badge tone="slate">{t('common.user')}</Badge>}</td>
                      <td className="pr-3 text-xs">
                        {Object.entries(u.balances)
                          .filter(([, v]) => v !== '0')
                          .map(([c, v]) => (
                            <span key={c} className="mr-2 whitespace-nowrap">
                              <Amount value={v} currency={c} symbol={false} code trimZeros />
                            </span>
                          ))}
                      </td>
                      <td className="pr-3 text-right font-medium">
                        <Amount value={u.total_jpy} currency="JPY" />
                      </td>
                      <td className="text-right text-xs text-slate-500">
                        {u.merchants} / {u.payments}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="min-w-0">{selected ? <UserDetail userId={selected} /> : <Card><EmptyState>{t('a.users.select_hint')}</EmptyState></Card>}</div>
      </div>
    </div>
  );
}

function UserDetail({ userId }: { userId: string }) {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['admin', 'user', userId], queryFn: () => api.get<AdminUserDetail>(`/admin/users/${userId}`) });
  if (q.isLoading) return <Card><Spinner /></Card>;
  if (q.error) return <Card><ErrorText>{errorMessage(q.error)}</ErrorText></Card>;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <Card title={t('a.users.profile')}>
        <Row label={t('a.users.display_name')} value={d.me.profile.display_name ?? '-'} />
        <Row label={t('common.email')} value={d.me.profile.email ?? '-'} />
        <Row label={t('a.users.user_id')} value={d.me.profile.user_id} mono />
        <Row label={t('a.users.registered')} value={formatDate(d.me.profile.created_at)} />
        <Row label={t('a.users.total_assets')} value={<Amount value={d.me.total_jpy} currency="JPY" className="font-semibold" />} />
        {d.virtual_bank_account && <Row label={t('a.users.virtual_bank')} value={`${d.virtual_bank_account.bank_name} ${d.virtual_bank_account.branch_code} ${d.virtual_bank_account.account_number}`} />}
      </Card>
      <Card title={t('common.balance')}>
        <ul className="text-sm">
          {d.me.wallets.map((w) => (
            <li key={w.currency} className="flex justify-between py-0.5">
              <span>{w.currency}</span>
              <Amount value={w.balance} currency={w.currency} trimZeros />
            </li>
          ))}
        </ul>
      </Card>
      {d.merchants.length > 0 && (
        <Card title={t('a.users.owned_merchants')}>
          <ul className="text-sm">
            {d.merchants.map((m) => (
              <li key={m.id} className="py-0.5">
                {m.name} <span className="text-xs text-slate-500">({m.settlement_currency})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t('a.users.recent_tx')}>
        {d.transactions.length === 0 && <EmptyState>{t('a.users.no_tx')}</EmptyState>}
        <ul className="divide-y divide-slate-100">
          {d.transactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
