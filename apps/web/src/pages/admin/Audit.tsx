import { useQuery } from '@tanstack/react-query';
import { Badge, Card, EmptyState, ErrorText, Spinner, formatDate } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

interface AuditLog {
  id: number;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

/** /admin/audit — 監査ログ（加盟店作成、APIキー発行/失効、決済、返金、キャンセル） */
export function AdminAuditPage() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api.get<{ data: AuditLog[] }>('/admin/audit-logs'), refetchInterval: 15_000 });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">監査ログ</h1>
      <Card>
        {q.isLoading && <Spinner />}
        {q.error && <ErrorText>{errorMessage(q.error)}</ErrorText>}
        {q.data && q.data.data.length === 0 && <EmptyState>ログはありません</EmptyState>}
        {q.data && q.data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs [&_td]:pr-3 [&_th]:pr-3">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1">日時</th>
                  <th>アクター</th>
                  <th>アクション</th>
                  <th>対象</th>
                  <th>メタデータ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.data.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1 text-slate-500">{formatDate(l.created_at)}</td>
                    <td>
                      <Badge tone="slate">{l.actor_type}</Badge> <span className="font-mono text-[10px] text-slate-400">{l.actor_id?.slice(0, 8)}</span>
                    </td>
                    <td className="font-mono">{l.action}</td>
                    <td className="font-mono">
                      {l.target_type}:{l.target_id}
                    </td>
                    <td className="max-w-80 truncate font-mono text-slate-500">{JSON.stringify(l.metadata)}</td>
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
