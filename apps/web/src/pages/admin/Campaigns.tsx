import { formatAmount, type PointCampaign } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Input, Spinner, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { api, errorMessage } from '../../lib/api';

/** /admin/campaigns — ポイントキャンペーンの一覧と作成 */
export function AdminCampaignsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api.get<{ data: PointCampaign[] }>('/admin/point-campaigns') });
  const [name, setName] = useState('');
  const [rate, setRate] = useState('2');
  const [min, setMin] = useState('1000');
  const [days, setDays] = useState('30');
  const create = useMutation({
    mutationFn: () =>
      api.post<PointCampaign>('/admin/point-campaigns', {
        name,
        bonus_rate: (Number(rate) / 100).toString(),
        min_amount: String(Math.max(0, Math.floor(Number(min)))),
        active_to: new Date(Date.now() + Number(days) * 86400_000).toISOString(),
      }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['admin', 'campaigns'] });
      qc.invalidateQueries({ queryKey: ['points', 'campaigns'] });
    },
  });
  const now = Date.now();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t('a.campaigns.title')}</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          {q.isLoading && <Spinner />}
          {q.data && q.data.data.length === 0 && <EmptyState>{t('a.campaigns.empty')}</EmptyState>}
          {q.data && q.data.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm [&_td]:pr-3 [&_th]:pr-3">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1">{t('common.name')}</th>
                    <th>{t('a.campaigns.th_bonus')}</th>
                    <th>{t('a.campaigns.th_min')}</th>
                    <th>{t('a.campaigns.th_period')}</th>
                    <th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {q.data.data.map((c) => {
                    const active = new Date(c.active_from).getTime() <= now && new Date(c.active_to).getTime() >= now;
                    return (
                      <tr key={c.id}>
                        <td className="py-2 font-medium">{c.name}</td>
                        <td>+{(Number(c.bonus_rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%</td>
                        <td>{t('a.campaigns.min_or_more', { amount: formatAmount(c.min_amount, 'JPY') })}</td>
                        <td className="text-xs text-slate-500">{t('a.campaigns.period_range', { from: formatDate(c.active_from), to: formatDate(c.active_to) })}</td>
                        <td>{active ? <Badge tone="green">{t('a.campaigns.active')}</Badge> : <Badge tone="slate">{t('a.campaigns.inactive')}</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={t('a.campaigns.create_title')}>
          <form
            className="space-y-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('a.campaigns.name_placeholder')} />
            <div className="grid grid-cols-3 gap-2">
              <Input label={t('a.campaigns.bonus_pct')} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <Input label={t('a.campaigns.min_jpy')} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
              <Input label={t('a.campaigns.days')} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
            <Button type="submit" loading={create.isPending}>
              {t('a.campaigns.create')}
            </Button>
          </form>
          <p className="mt-2 text-[11px] text-slate-500">{t('a.campaigns.note')}</p>
        </Card>
      </div>
    </div>
  );
}
