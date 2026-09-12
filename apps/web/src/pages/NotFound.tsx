import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-5xl font-bold text-slate-300">404</p>
        <p className="mt-2 text-slate-600">{t('notfound.title')}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-brand-600 underline">
          {t('common.back_home')}
        </Link>
      </div>
    </div>
  );
}
