import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { setTokenProvider } from './api';
import { createAuthAdapter, type AuthAdapter, type Session } from './auth';

interface AuthState {
  adapter: AuthAdapter;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  setSession: (s: Session | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAuthAdapter(), []);
  const [session, setSessionState] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionRef = useRef<Session | null>(null);
  const queryClient = useQueryClient();

  const setSession = useCallback(
    (s: Session | null) => {
      sessionRef.current = s;
      setSessionState(s);
      if (!s) queryClient.clear();
    },
    [queryClient],
  );

  useEffect(() => {
    setTokenProvider(async () => {
      if (sessionRef.current) return sessionRef.current.accessToken;
      const s = await adapter.getSession();
      sessionRef.current = s;
      return s?.accessToken ?? null;
    });
    let cancelled = false;
    adapter.getSession().then((s) => {
      if (cancelled) return;
      sessionRef.current = s;
      setSessionState(s);
      setLoading(false);
    });
    const off = adapter.onChange((s) => setSession(s));
    return () => {
      cancelled = true;
      off();
    };
  }, [adapter, setSession]);

  const signOut = useCallback(async () => {
    await adapter.signOut();
    setSession(null);
  }, [adapter, setSession]);

  const value = useMemo<AuthState>(() => ({ adapter, session, loading, signOut, setSession }), [adapter, session, loading, signOut, setSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider が必要です');
  return ctx;
}
