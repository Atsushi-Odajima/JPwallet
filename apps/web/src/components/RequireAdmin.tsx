import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../lib/queries';
import { Spinner } from './ui';

/** 管理者ロール（profiles.role = 'admin'）でなければ案内を表示する */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isLoading) return <Spinner className="min-h-screen" />;
  if (me.data?.profile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <p className="text-lg font-bold">管理者権限が必要です</p>
          <p className="mt-2 text-sm text-slate-600">ログイン画面の「管理者」タブから管理者アカウント（ID: kuro）でログインしてください。</p>
          <Link to="/login" className="mt-4 inline-block text-sm text-brand-600 underline">
            ログイン画面へ
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
