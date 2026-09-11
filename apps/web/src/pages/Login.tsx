import { ADMIN_LOGIN_ID, APP_NAME } from '@payccount/shared';
import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Button, Card, ErrorText, Input, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth-context';

type Tab = 'user' | 'admin';

/** /login — Supabase Auth（メール OTP）またはデモ認証。管理者は ID + パスワード */
export function LoginPage() {
  const { adapter, session, loading, setSession } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  const [tab, setTab] = useState<Tab>('user');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [adminId, setAdminId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** ログイン後の遷移先（管理者は /admin）。session が入ると <Navigate> が使う */
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  if (loading) return <Spinner className="min-h-screen" />;
  if (session) return <Navigate to={redirectTo ?? next} replace />;

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await adapter.signInWithEmail(email.trim());
      if (r.needsOtp) {
        setOtpSent(true);
      } else if (r.session) {
        setRedirectTo(next);
        setSession(r.session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await adapter.verifyOtp(email.trim(), otp.trim());
      setRedirectTo(next);
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitAdmin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await adapter.signInAdmin(adminId.trim(), password);
      setRedirectTo(next === '/' ? '/admin' : next);
      setSession(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-6 text-center">
          <img src="/icons/icon.svg" alt="" className="mx-auto mb-3 h-16 w-16 rounded-2xl shadow" />
          <h1 className="text-2xl font-bold text-brand-800">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-slate-500">日本産オンラインEウォレット（デモ）</p>
        </div>

        <Card>
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            <button
              type="button"
              className={`rounded-lg py-1.5 ${tab === 'user' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => {
                setTab('user');
                setError(null);
              }}
            >
              ユーザー
            </button>
            <button
              type="button"
              className={`rounded-lg py-1.5 ${tab === 'admin' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              onClick={() => {
                setTab('admin');
                setError(null);
              }}
            >
              管理者
            </button>
          </div>

          {tab === 'user' && !otpSent && (
            <form onSubmit={submitEmail} className="space-y-3">
              <Input
                label="メールアドレス"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                hint={
                  adapter.mode === 'demo'
                    ? 'デモ認証: メールアドレスを入力するだけでログインできます（認証コードは送信されません）'
                    : '入力したメールアドレスにログイン用のリンク（または 6 桁の認証コード）を送ります'
                }
              />
              <ErrorText>{error}</ErrorText>
              <Button type="submit" className="w-full" loading={busy}>
                {adapter.mode === 'demo' ? 'ログイン / 新規登録' : '認証コードを送信'}
              </Button>
            </form>
          )}

          {tab === 'user' && otpSent && (
            <form onSubmit={submitOtp} className="space-y-3">
              <p className="text-sm text-slate-600">
                <span className="font-medium">{email}</span> にメールを送りました。メール内の「ログイン」リンクをタップするとこの画面に戻ってログインします。6 桁のコードが届いた場合は下に入力してください。
              </p>
              <Input
                label="認証コード"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <ErrorText>{error}</ErrorText>
              <Button type="submit" className="w-full" loading={busy}>
                ログイン
              </Button>
              <button type="button" className="w-full text-center text-xs text-slate-500 underline" onClick={() => setOtpSent(false)}>
                メールアドレスを変更する
              </button>
            </form>
          )}

          {tab === 'admin' && (
            <form onSubmit={submitAdmin} className="space-y-3">
              <Input label="管理者ID" required autoComplete="username" placeholder={ADMIN_LOGIN_ID} value={adminId} onChange={(e) => setAdminId(e.target.value)} />
              <Input
                label="パスワード"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <ErrorText>{error}</ErrorText>
              <Button type="submit" className="w-full" loading={busy}>
                管理者としてログイン
              </Button>
              <p className="text-xs text-slate-500">管理者は全ユーザー・加盟店・台帳を閲覧できます。</p>
            </form>
          )}
        </Card>
      </main>
    </div>
  );
}
