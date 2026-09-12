import type { WebhookDelivery } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorText, Select, Spinner, SuccessText, formatDate } from '../../components/ui';
import { useI18n } from '../../i18n';
import { deliveryStatusLabel } from '../../i18n/labels';
import { api, errorMessage } from '../../lib/api';

type AdminDelivery = WebhookDelivery & { merchant_id: string; merchant_name: string; event_type: string };

/** /admin/webhooks — 全加盟店の Webhook 配信状況と手動配信 */
export function AdminWebhooksPage() {
  const { t } = useI18n();
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
      setMsg(t('a.webhooks.run_done', { claimed: r.webhooks.claimed, delivered: r.webhooks.delivered, failed: r.webhooks.failed, requeued: r.requeued_stale_deliveries }));
      qc.invalidateQueries({ queryKey: ['admin', 'deliveries'] });
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t('a.webhooks.title')}</h1>
        <Button variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
          {t('a.webhooks.run_due')}
        </Button>
      </div>
      <SuccessText>{msg}</SuccessText>
      <ErrorText>{run.error ? errorMessage(run.error) : null}</ErrorText>
      <Card>
        <div className="mb-3 max-w-xs">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('common.all')}</option>
            <option value="pending">{t('a.webhooks.opt_pending')}</option>
            <option value="in_flight">in_flight</option>
            <option value="delivered">delivered</option>
            <option value="failed">{t('a.webhooks.opt_failed')}</option>
          </Select>
        </div>
        {q.isLoading && <Spinner />}
        {q.data && q.data.data.length === 0 && <EmptyState>{t('a.webhooks.empty')}</EmptyState>}
        {q.data && q.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs [&_td]:pr-3 [&_th]:pr-3">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1">{t('common.updated_at')}</th>
                  <th>{t('common.merchant')}</th>
                  <th>{t('a.webhooks.th_event')}</th>
                  <th>URL</th>
                  <th>{t('common.status')}</th>
                  <th className="text-right">{t('a.webhooks.th_attempts')}</th>
                  <th>HTTP</th>
                  <th>{t('a.webhooks.th_next')}</th>
                  <th>{t('a.webhooks.th_error')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.data.map((d) => {
                  const st = deliveryStatusLabel(t, d.status);
                  return (
                    <tr key={d.id}>
                      <td className="py-1 text-slate-500">{formatDate(d.created_at)}</td>
                      <td>{d.merchant_name}</td>
                      <td className="font-mono">{d.event_type}</td>
                      <td className="max-w-60 truncate font-mono">{d.url}</td>
                      <td>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </td>
                      <td className="text-right">{d.attempts}</td>
                      <td>{d.last_status_code ?? '-'}</td>
                      <td className="text-slate-500">{d.next_retry_at ? formatDate(d.next_retry_at) : '-'}</td>
                      <td className="max-w-60 truncate text-rose-600">{d.last_error ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
