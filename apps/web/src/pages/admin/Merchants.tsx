import { SETTLEMENT_CODES, type ApiKey, type Merchant } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Amount } from '../../components/Amount';
import { Button, Card, CopyButton, EmptyState, ErrorText, Input, Select, Spinner, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { api, errorMessage } from '../../lib/api';

interface AdminMerchant extends Merchant {
  owner_email: string | null;
  balance: { currency: string; amount: string }[];
  payments_count: number;
}

/** /admin/merchants — 全加盟店と作成（初回 APIキー発行） */
export function AdminMerchantsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'merchants'], queryFn: () => api.get<{ data: AdminMerchant[] }>('/admin/merchants') });
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('JPY');
  const [country, setCountry] = useState('JP');
  const [created, setCreated] = useState<{ merchant: Merchant; api_key: ApiKey } | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<{ merchant: Merchant; api_key: ApiKey }>('/admin/merchants', { name, settlement_currency: currency, country }),
    onSuccess: (r) => {
      setCreated(r);
      setName('');
      qc.invalidateQueries({ queryKey: ['admin', 'merchants'] });
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('a.merchants.title')}</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          {q.isLoading && <Spinner />}
          {q.error && <ErrorText>{errorMessage(q.error)}</ErrorText>}
          {q.data && q.data.data.length === 0 && <EmptyState>{t('a.merchants.empty')}</EmptyState>}
          {q.data && q.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">{t('a.merchants.th_shop')}</th>
                    <th className="pr-3">{t('a.merchants.th_owner')}</th>
                    <th className="pr-3">{t('a.merchants.th_settlement')}</th>
                    <th className="pr-3 text-right">{t('common.balance')}</th>
                    <th className="pr-3 text-right">{t('a.merchants.th_payments_count')}</th>
                    <th>{t('a.merchants.th_registered')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.data.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2 pr-3">
                        <p className="font-medium">{m.name}</p>
                        <p className="font-mono text-[10px] text-slate-400">{m.id.slice(0, 8)}…</p>
                      </td>
                      <td className="pr-3 text-xs">{m.owner_email ?? m.owner_user_id}</td>
                      <td className="pr-3">
                        {m.settlement_currency} <span className="text-xs text-slate-500">{m.fee_bps / 100}%</span>
                      </td>
                      <td className="pr-3 text-right">
                        {m.balance.map((b) => (
                          <span key={b.currency} className="ml-2">
                            <Amount value={b.amount} currency={b.currency} />
                          </span>
                        ))}
                      </td>
                      <td className="pr-3 text-right">{m.payments_count}</td>
                      <td className="text-xs text-slate-500">{formatDate(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={t('a.merchants.create_title')}>
          <form
            className="space-y-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              setCreated(null);
              create.mutate();
            }}
          >
            <Input label={t('a.merchants.shop_name')} value={name} onChange={(e) => setName(e.target.value)} required />
            <div className="grid grid-cols-2 gap-2">
              <Select label={t('a.merchants.settlement_currency')} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {SETTLEMENT_CODES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
              <Select label={t('a.merchants.country')} value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="JP">JP</option>
                <option value="US">US</option>
                <option value="GB">GB</option>
                <option value="DE">DE</option>
              </Select>
            </div>
            <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
            <Button type="submit" loading={create.isPending}>
              {t('a.merchants.create_submit')}
            </Button>
          </form>
          {created?.api_key.key && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="font-semibold text-amber-900">{t('a.merchants.api_key_once', { name: created.merchant.name })}</p>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono">{created.api_key.key}</code>
                <CopyButton text={created.api_key.key} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
