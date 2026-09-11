import type { Me, Notification, Page, Transaction } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth-context';

/** TanStack Query のキー */
export const qk = {
  me: ['me'] as const,
  transactions: (params: Record<string, string | undefined>) => ['me', 'transactions', params] as const,
  notifications: ['me', 'notifications'] as const,
};

export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.get<Me>('/me'),
    enabled: !!session,
  });
}

export function useTransactions(params: { currency?: string; type?: string; limit?: number } = {}) {
  const { session } = useAuth();
  const search = new URLSearchParams();
  if (params.currency) search.set('currency', params.currency);
  if (params.type) search.set('type', params.type);
  search.set('limit', String(params.limit ?? 20));
  return useQuery({
    queryKey: qk.transactions({ currency: params.currency, type: params.type, limit: String(params.limit ?? 20) }),
    queryFn: () => api.get<Page<Transaction>>(`/me/transactions?${search.toString()}`),
    enabled: !!session,
  });
}

export function useNotifications(pollMs = 10_000) {
  const { session } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.get<{ data: Notification[]; unread_count: number }>('/me/notifications?limit=20'),
    enabled: !!session,
    refetchInterval: pollMs,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => api.post<{ updated: number }>('/me/notifications/read', ids ? { ids } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

/** 残高に影響する操作の後に呼ぶ */
export function useInvalidateWallet() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.me });
    qc.invalidateQueries({ queryKey: ['me', 'transactions'] });
    qc.invalidateQueries({ queryKey: qk.notifications });
  };
}
