import { WEBHOOK_EVENT_TYPES, type ApiKey, type ApiRequestLog, type Page, type WebhookEndpoint, type WebhookEvent } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, RefreshCw, Send, Webhook } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorText, Input, PageTitle, Spinner, SuccessText, formatDate } from '../../components/ui';
import { API_URL, api, errorMessage } from '../../lib/api';
import { merchantPath, useMerchant } from '../../lib/merchant';

/** /merchant/developers — APIキー、Webhook、イベントログ、リクエストログ */
export function MerchantDevelopersPage() {
  const { merchant } = useMerchant();
  if (!merchant) return null;
  return (
    <div className="space-y-4">
      <PageTitle sub={`API ベース URL: ${API_URL}`}>開発者</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <ApiKeys merchantId={merchant.id} />
        <WebhookEndpoints merchantId={merchant.id} />
      </div>
      <EventsLog merchantId={merchant.id} />
      <RequestLogs merchantId={merchant.id} />
    </div>
  );
}

function ApiKeys({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['merchant', merchantId, 'api-keys'], queryFn: () => api.get<{ data: ApiKey[] }>(merchantPath(merchantId, '/api-keys')) });
  const [issued, setIssued] = useState<ApiKey | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<ApiKey>(merchantPath(merchantId, '/api-keys')),
    onSuccess: (k) => {
      setIssued(k);
      qc.invalidateQueries({ queryKey: ['merchant', merchantId, 'api-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(merchantPath(merchantId, `/api-keys/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant', merchantId, 'api-keys'] }),
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-1">
          <KeyRound className="h-4 w-4" /> APIキー（テストモード）
        </span>
      }
      action={
        <Button className="py-1.5" loading={create.isPending} onClick={() => create.mutate()}>
          新しいキーを発行
        </Button>
      }
    >
      {issued?.key && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="flex items-center gap-1 font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> このキーは今だけ表示されます。安全な場所に保存してください。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{issued.key}</code>
            <CopyButton text={issued.key} />
          </div>
        </div>
      )}
      <ErrorText>{create.error ? errorMessage(create.error) : revoke.error ? errorMessage(revoke.error) : null}</ErrorText>
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>APIキーはまだありません</EmptyState>}
      <ul className="divide-y divide-slate-100 text-sm">
        {q.data?.data.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-2">
            <div>
              <p className="font-mono">{k.prefix}</p>
              <p className="text-xs text-slate-500">
                作成 {formatDate(k.created_at)} · 最終利用 {k.last_used_at ? formatDate(k.last_used_at) : '-'}
              </p>
            </div>
            {k.revoked_at ? (
              <Badge tone="slate">失効</Badge>
            ) : (
              <Button variant="ghost" className="py-1 text-rose-600" onClick={() => revoke.mutate(k.id)}>
                失効
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function WebhookEndpoints({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['merchant', merchantId, 'webhooks'], queryFn: () => api.get<Page<WebhookEndpoint>>(merchantPath(merchantId, '/webhook-endpoints')) });
  const [url, setUrl] = useState('http://localhost:5174/api/webhook');
  const [events, setEvents] = useState<string[]>(['*']);
  const [created, setCreated] = useState<WebhookEndpoint | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<WebhookEndpoint>(merchantPath(merchantId, '/webhook-endpoints'), { url, events }),
    onSuccess: (e) => {
      setCreated(e);
      qc.invalidateQueries({ queryKey: ['merchant', merchantId, 'webhooks'] });
    },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(merchantPath(merchantId, `/webhook-endpoints/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant', merchantId, 'webhooks'] }),
  });
  const toggle = (ev: string) => {
    if (ev === '*') return setEvents(['*']);
    const next = events.filter((e) => e !== '*');
    setEvents(next.includes(ev) ? next.filter((e) => e !== ev) : [...next, ev]);
  };
  return (
    <Card
      title={
        <span className="flex items-center gap-1">
          <Webhook className="h-4 w-4" /> Webhook エンドポイント
        </span>
      }
    >
      <form
        className="space-y-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setCreated(null);
          create.mutate();
        }}
      >
        <Input label="URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example/api/webhook" />
        <div className="flex flex-wrap gap-1 text-xs">
          {['*', ...WEBHOOK_EVENT_TYPES].map((ev) => (
            <button
              key={ev}
              type="button"
              onClick={() => toggle(ev)}
              className={`rounded-full border px-2 py-0.5 ${events.includes(ev) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}
            >
              {ev === '*' ? 'すべて' : ev}
            </button>
          ))}
        </div>
        <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
        <Button type="submit" variant="secondary" loading={create.isPending} disabled={events.length === 0}>
          エンドポイントを追加
        </Button>
      </form>
      {created?.secret && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">署名シークレット（今だけ表示）</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{created.secret}</code>
            <CopyButton text={created.secret} />
          </div>
          <p className="mt-1 text-xs text-amber-800">
            受信側は <code>X-payCcount-Signature</code> を SDK の <code>verifyWebhookSignature</code> で検証してください。
          </p>
        </div>
      )}
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>エンドポイントはまだありません</EmptyState>}
      <ul className="mt-3 divide-y divide-slate-100 text-sm">
        {q.data?.data.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs">{e.url}</p>
              <p className="text-xs text-slate-500">
                {e.id} · {e.events.join(', ')}
              </p>
            </div>
            <Button variant="ghost" className="py-1 text-rose-600" onClick={() => del.mutate(e.id)}>
              削除
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const DELIVERY_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate'> = { delivered: 'green', pending: 'amber', in_flight: 'amber', failed: 'red' };

function EventsLog({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['merchant', merchantId, 'events'],
    queryFn: () => api.get<Page<WebhookEvent>>(merchantPath(merchantId, '/events?limit=20')),
    refetchInterval: 10_000,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const resend = useMutation({
    mutationFn: (id: string) => api.post(merchantPath(merchantId, `/events/${id}/resend`)),
    onSuccess: () => {
      setMsg('再送をキューに入れました');
      qc.invalidateQueries({ queryKey: ['merchant', merchantId, 'events'] });
    },
  });
  const deliverNow = useMutation({
    mutationFn: () => api.post<{ claimed: number; delivered: number; failed: number }>(merchantPath(merchantId, '/webhooks/deliver-now')),
    onSuccess: (r) => {
      setMsg(`配信を実行しました（対象 ${r.claimed} 件、成功 ${r.delivered}、失敗 ${r.failed}）`);
      qc.invalidateQueries({ queryKey: ['merchant', merchantId, 'events'] });
    },
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card
      title="イベントログ（Webhook 配信）"
      action={
        <Button variant="secondary" className="py-1.5" loading={deliverNow.isPending} onClick={() => deliverNow.mutate()}>
          <RefreshCw className="h-4 w-4" /> 今すぐ配信
        </Button>
      }
    >
      <p className="mb-2 text-xs text-slate-500">失敗した配信は 1分 → 5分 → 30分 → 2時間 → 12時間 の間隔で最大 5 回リトライされます（Cron）。</p>
      <SuccessText>{msg}</SuccessText>
      <ErrorText>{resend.error ? errorMessage(resend.error) : deliverNow.error ? errorMessage(deliverNow.error) : null}</ErrorText>
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>イベントはまだありません</EmptyState>}
      <ul className="divide-y divide-slate-100 text-sm">
        {q.data?.data.map((ev) => (
          <li key={ev.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-left" onClick={() => setOpen(open === ev.id ? null : ev.id)}>
                <p className="font-medium">{ev.type}</p>
                <p className="font-mono text-xs text-slate-500">
                  {ev.id} · {formatDate(ev.created_at)}
                </p>
              </button>
              <div className="flex items-center gap-2">
                {(ev.deliveries ?? []).slice(-1).map((d) => (
                  <Badge key={d.id} tone={DELIVERY_TONE[d.status] ?? 'slate'}>
                    {d.status} {d.last_status_code ? `(${d.last_status_code})` : ''} ×{d.attempts}
                  </Badge>
                ))}
                {(ev.deliveries ?? []).length === 0 && <Badge tone="slate">配信先なし</Badge>}
                <Button variant="ghost" className="py-1" onClick={() => resend.mutate(ev.id)} loading={resend.isPending}>
                  <Send className="h-3.5 w-3.5" /> 再送
                </Button>
              </div>
            </div>
            {open === ev.id && (
              <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2 text-xs">
                {(ev.deliveries ?? []).map((d) => (
                  <div key={d.id} className="rounded bg-white p-2">
                    <p className="flex flex-wrap gap-2">
                      <Badge tone={DELIVERY_TONE[d.status] ?? 'slate'}>{d.status}</Badge>
                      <span className="font-mono">{d.url}</span>
                      <span>試行 {d.attempts} 回</span>
                      {d.next_retry_at && <span>次回 {formatDate(d.next_retry_at)}</span>}
                    </p>
                    {d.last_error && <p className="mt-1 text-rose-600">{d.last_error}</p>}
                    {d.last_response_body && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-[10px] text-slate-600">{d.last_response_body}</pre>}
                  </div>
                ))}
                <details>
                  <summary className="cursor-pointer text-slate-600">ペイロード</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-slate-900 p-2 text-[10px] text-slate-100">{JSON.stringify({ id: ev.id, type: ev.type, created: ev.created, demo: ev.demo, data: ev.data }, null, 2)}</pre>
                </details>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RequestLogs({ merchantId }: { merchantId: string }) {
  const q = useQuery({
    queryKey: ['merchant', merchantId, 'request-logs'],
    queryFn: () => api.get<{ data: ApiRequestLog[] }>(merchantPath(merchantId, '/request-logs')),
    refetchInterval: 10_000,
  });
  return (
    <Card title="API リクエストログ（直近 50 件）">
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>まだリクエストはありません</EmptyState>}
      {q.data && q.data.data.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full whitespace-nowrap text-xs [&_td]:pr-3 [&_th]:pr-3">
            <thead className="sticky top-0 bg-white text-left text-slate-500">
              <tr>
                <th className="py-1">日時</th>
                <th>メソッド</th>
                <th>パス</th>
                <th>ステータス</th>
                <th className="text-right">ms</th>
                <th>Request-Id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {q.data.data.map((l) => (
                <tr key={l.id}>
                  <td className="py-1 text-slate-500">{formatDate(l.created_at)}</td>
                  <td>{l.method}</td>
                  <td className="max-w-60 truncate">{l.path}</td>
                  <td className={l.status_code >= 400 ? 'text-rose-600' : 'text-emerald-700'}>{l.status_code}</td>
                  <td className="text-right">{l.duration_ms}</td>
                  <td className="text-slate-400">{l.request_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
