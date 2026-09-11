import type { WebhookDelivery } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Select, Spinner, SuccessText, formatDate } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

type AdminDelivery = WebhookDelivery & { merchant_id: string; merchant_name: string; event_type: string };
const TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { delivered: 'green', pending: 'amber', in_flight: 'amber', failed: 'red' };

/** /admin/webhooks — 全加盟店の Webhook 配信状況と手動配信 */
export function AdminWebhooksPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const q = useQuery({
    queryKey: ['admin', 'deliveries', status],
    queryFn: () => api.get<{ data: AdminDelivery[] }>(`/admin/webhooks/deliveries?limit=200${status ? `&status=${status}` : ''}`),
    refetchInterval: 10_000,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api.post<{ webhooks: { claimed: number; delivered: number; failed: number }; requeued_stale_deliveries: number }>('/admin/maintenance/run'),
    onSuccess: (r) => {
      setMsg(`配信を実行: 対象 ${r.webhooks.claimed} 件（成功 ${r.webhooks.delivered} / 失敗 ${r.webhooks.failed}）、再キュー ${r.requeued_stale_deliveries}`);
      qc.invalidateQueries({ queryKey: ['admin', 'deliveries'] });
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Webhook 配信</h1>
        <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
          期限が来た配信を今すぐ実行
        </Button>
      </div>
      <SuccessText>{msg}</SuccessText>
      <ErrorText>{run.error ? errorMessage(run.error) : null}</ErrorText>
      <Card>
        <div className="mb-3 max-w-xs">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">すべて</option>
            <option value="pending">pending（再試行待ち）</option>
            <option value="in_flight">in_flight</option>
            <option value="delivered">delivered</option>
            <option value="failed">failed（5 回失敗）</option>
          </Select>
        </div>
        {q.isLoading && <Spinner />}
        {q.data && q.data.data.length === 0 && <EmptyState>配信はありません</EmptyState>}
        {q.data && q.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1">更新</th>
                  <th>加盟店</th>
                  <th>イベント</th>
                  <th>URL</th>
                  <th>状態</th>
                  <th className="text-right">試行</th>
                  <th>HTTP</th>
                  <th>次回</th>
                  <th>エラー</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.data.map((d) => (
                  <tr key={d.id}>
                    <td className="py-1 text-slate-500">{formatDate(d.created_at)}</td>
                    <td>{d.merchant_name}</td>
                    <td className="font-mono">{d.event_type}</td>
                    <td className="max-w-60 truncate font-mono">{d.url}</td>
                    <td>
                      <Badge tone={TONE[d.status] ?? 'slate'}>{d.status}</Badge>
                    </td>
                    <td className="text-right">{d.attempts}</td>
                    <td>{d.last_status_code ?? '-'}</td>
                    <td className="text-slate-500">{d.next_retry_at ? formatDate(d.next_retry_at) : '-'}</td>
                    <td className="max-w-60 truncate text-rose-600">{d.last_error ?? ''}</td>
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
