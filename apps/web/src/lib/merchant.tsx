import type { Merchant } from '@payccount/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth-context';

const STORAGE_KEY = 'payccount.merchant';

interface MerchantState {
  merchants: Merchant[];
  merchant: Merchant | null;
  loading: boolean;
  select: (id: string) => void;
  refresh: () => Promise<void>;
}

const MerchantContext = createContext<MerchantState | null>(null);

/** ログインユーザーが所有する加盟店と、選択中の加盟店 */
export function MerchantProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me', 'merchants'],
    queryFn: () => api.get<{ data: Merchant[] }>('/me/merchants'),
    enabled: !!session,
  });
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const merchants = q.data?.data ?? [];
  const merchant = useMemo(() => merchants.find((m) => m.id === selected) ?? merchants[0] ?? null, [merchants, selected]);

  useEffect(() => {
    if (merchant && merchant.id !== selected) {
      setSelected(merchant.id);
      try {
        localStorage.setItem(STORAGE_KEY, merchant.id);
      } catch {
        /* ignore */
      }
    }
  }, [merchant, selected]);

  const select = useCallback((id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['me', 'merchants'] });
  }, [qc]);

  const value = useMemo<MerchantState>(() => ({ merchants, merchant, loading: q.isLoading, select, refresh }), [merchants, merchant, q.isLoading, select, refresh]);
  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant(): MerchantState {
  const ctx = useContext(MerchantContext);
  if (!ctx) throw new Error('MerchantProvider が必要です');
  return ctx;
}

/** 選択中の加盟店を前提にした API パス */
export function merchantPath(merchantId: string, suffix = '') {
  return `/me/merchants/${merchantId}${suffix}`;
}
