import { ADMIN_EMAIL_DOMAIN } from '@payccount/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API_URL } from './api';

/**
 * 認証アダプタ。
 *   - VITE_SUPABASE_URL があれば Supabase Auth（メール OTP / 管理者はパスワード）
 *   - なければデモ認証（API の /auth/demo/*。メールアドレスだけでログイン）
 * どちらも API へは Bearer JWT を渡す。
 */
export interface Session {
  accessToken: string;
  userId: string;
  email?: string;
  expiresAt?: string;
}

export interface AuthAdapter {
  readonly mode: 'supabase' | 'demo';
  getSession(): Promise<Session | null>;
  /** メールでサインイン開始。Supabase は OTP 送信、デモは即ログイン */
  signInWithEmail(email: string): Promise<{ needsOtp: boolean; session?: Session }>;
  verifyOtp(email: string, token: string): Promise<Session>;
  signInAdmin(id: string, password: string): Promise<Session>;
  signOut(): Promise<void>;
  onChange(cb: (s: Session | null) => void): () => void;
}

const DEMO_STORAGE_KEY = 'payccount.demo.session';

class DemoAuth implements AuthAdapter {
  readonly mode = 'demo' as const;
  private listeners = new Set<(s: Session | null) => void>();

  async getSession(): Promise<Session | null> {
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      if (s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) {
        localStorage.removeItem(DEMO_STORAGE_KEY);
        return null;
      }
      return s;
    } catch {
      return null;
    }
  }

  private async post(path: string, body: unknown): Promise<Session> {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? 'ログインに失敗しました');
    const session: Session = {
      accessToken: json.access_token,
      userId: json.user.id,
      email: json.user.email,
      expiresAt: json.expires_at,
    };
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(session));
    this.emit(session);
    return session;
  }

  async signInWithEmail(email: string) {
    const session = await this.post('/auth/demo/login', { email });
    return { needsOtp: false, session };
  }
  async verifyOtp(): Promise<Session> {
    throw new Error('デモ認証では OTP は不要です');
  }
  signInAdmin(id: string, password: string) {
    return this.post('/auth/demo/admin-login', { id, password });
  }
  async signOut() {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    this.emit(null);
  }
  onChange(cb: (s: Session | null) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private emit(s: Session | null) {
    for (const l of this.listeners) l(s);
  }
}

class SupabaseAuth implements AuthAdapter {
  readonly mode = 'supabase' as const;
  readonly client: SupabaseClient;
  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey);
  }
  private toSession(s: { access_token: string; user: { id: string; email?: string }; expires_at?: number } | null): Session | null {
    if (!s) return null;
    return {
      accessToken: s.access_token,
      userId: s.user.id,
      email: s.user.email,
      expiresAt: s.expires_at ? new Date(s.expires_at * 1000).toISOString() : undefined,
    };
  }
  async getSession() {
    const { data } = await this.client.auth.getSession();
    return this.toSession(data.session);
  }
  async signInWithEmail(email: string) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + '/login' },
    });
    if (error) throw new Error(error.message);
    return { needsOtp: true };
  }
  async verifyOtp(email: string, token: string) {
    const { data, error } = await this.client.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw new Error(error.message);
    const s = this.toSession(data.session);
    if (!s) throw new Error('セッションを取得できませんでした');
    return s;
  }
  async signInAdmin(id: string, password: string) {
    const email = id.includes('@') ? id : `${id}@${ADMIN_EMAIL_DOMAIN}`;
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error('IDまたはパスワードが正しくありません');
    const s = this.toSession(data.session);
    if (!s) throw new Error('セッションを取得できませんでした');
    return s;
  }
  async signOut() {
    await this.client.auth.signOut();
  }
  onChange(cb: (s: Session | null) => void) {
    const { data } = this.client.auth.onAuthStateChange((_evt, session) => cb(this.toSession(session)));
    return () => data.subscription.unsubscribe();
  }
}

export function createAuthAdapter(): AuthAdapter {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) return new SupabaseAuth(url, key);
  return new DemoAuth();
}
