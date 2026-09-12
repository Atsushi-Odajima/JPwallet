import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useMe } from '../lib/queries';
import { Spinner } from './ui';

/** 管理者ロール（profiles.role = 'admin'）でなければ案内を表示する */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  const { t } = useI18n();
  if (me.isLoading) return <Spinner className="min-h-screen" />;
  if (me.data?.profile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <p className="text-lg font-bold">{t('guard.admin_required')}</p>
          <p className="mt-2 text-sm text-slate-600">{t('guard.admin_hint')}</p>
          <Link to="/login" className="mt-4 inline-block text-sm text-brand-600 underline">
            {t('guard.to_login')}
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
