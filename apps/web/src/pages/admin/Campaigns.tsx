import { formatAmount, type PointCampaign } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Input, Spinner, formatDate } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

/** /admin/campaigns — ポイントキャンペーンの一覧と作成 */
export function AdminCampaignsPage() {
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
      <h1 className="text-xl font-bold">ポイントキャンペーン</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          {q.isLoading && <Spinner />}
          {q.data && q.data.data.length === 0 && <EmptyState>キャンペーンはありません</EmptyState>}
          {q.data && q.data.data.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1">名称</th>
                  <th>ボーナス</th>
                  <th>最低金額</th>
                  <th>期間</th>
                  <th>状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.data.map((c) => {
                  const active = new Date(c.active_from).getTime() <= now && new Date(c.active_to).getTime() >= now;
                  return (
                    <tr key={c.id}>
                      <td className="py-2 font-medium">{c.name}</td>
                      <td>+{(Number(c.bonus_rate) * 100).toFixed(2).replace(/\.?0+$/, '')}%</td>
                      <td>{formatAmount(c.min_amount, 'JPY')} 以上</td>
                      <td className="text-xs text-slate-500">
                        {formatDate(c.active_from)} 〜 {formatDate(c.active_to)}
                      </td>
                      <td>{active ? <Badge tone="green">実施中</Badge> : <Badge tone="slate">対象外</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="キャンペーンを作成">
          <form
            className="space-y-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Input label="名称" value={name} onChange={(e) => setName(e.target.value)} required placeholder="例: 秋のポイント +2%" />
            <div className="grid grid-cols-3 gap-2">
              <Input label="ボーナス（%）" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
              <Input label="最低金額（円）" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />
              <Input label="期間（日）" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
            <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
            <Button type="submit" loading={create.isPending}>
              作成
            </Button>
          </form>
          <p className="mt-2 text-[11px] text-slate-500">複数該当する場合はボーナス率が最大のものが適用されます。ボーナス分は points_issuer 勘定から発行されます。</p>
        </Card>
      </div>
    </div>
  );
}
