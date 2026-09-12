import type { Profile } from '@payccount/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorText, Input, PageTitle, Row, Select, Spinner, SuccessText } from '../components/ui';
import { useI18n } from '../i18n';
import { API_URL, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useInvalidateWallet, useMe } from '../lib/queries';

/** /settings — プロフィール、認証情報、ログアウト */
export function SettingsPage() {
  const { t } = useI18n();
  const { adapter, session, signOut } = useAuth();
  const me = useMe();
  const invalidate = useInvalidateWallet();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('JP');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me.data) {
      setName(me.data.profile.display_name ?? '');
      setCountry(me.data.profile.country);
    }
  }, [me.data]);

  const save = useMutation({
    mutationFn: () => api.patch<Profile>('/me', { display_name: name, country }),
    onSuccess: () => {
      setSaved(true);
      invalidate();
    },
  });

  if (me.isLoading) return <Spinner />;
  const profile = me.data?.profile;

  return (
    <div className="space-y-4">
      <PageTitle>{t('u.settings.title')}</PageTitle>
      <Card title={t('u.settings.profile')}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSaved(false);
            save.mutate();
          }}
        >
          <Input label={t('u.settings.display_name')} value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          <Select label={t('u.settings.country')} value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="JP">{t('u.settings.country.JP')}</option>
            <option value="US">{t('u.settings.country.US')}</option>
            <option value="GB">{t('u.settings.country.GB')}</option>
            <option value="DE">{t('u.settings.country.DE')}</option>
          </Select>
          <ErrorText>{save.error ? errorMessage(save.error) : null}</ErrorText>
          <SuccessText>{saved ? t('u.settings.saved') : null}</SuccessText>
          <Button type="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>

      <Card title={t('u.settings.account')}>
        <Row label={t('common.email')} value={profile?.email ?? session?.email ?? '-'} />
        <Row label={t('u.settings.user_id')} value={profile?.user_id ?? '-'} mono />
        <Row label={t('u.settings.role')} value={profile?.role === 'admin' ? t('u.settings.role_admin') : t('u.settings.role_user')} />
        <Row label={t('u.settings.auth_method')} value={adapter.mode === 'supabase' ? t('u.settings.auth_supabase') : t('u.settings.auth_demo')} />
        <Row label="API" value={API_URL} mono />
        {profile?.role === 'admin' && (
          <Link to="/admin" className="mt-2 inline-block text-sm font-medium text-brand-600 underline">
            {t('u.settings.open_admin')}
          </Link>
        )}
        <div className="mt-4">
          <Button variant="danger" onClick={() => signOut()}>
            {t('common.logout')}
          </Button>
        </div>
      </Card>

      <Card title={t('u.settings.merchant_title')}>
        <p className="text-sm text-slate-600">{t('u.settings.merchant_desc')}</p>
        <Link to="/merchant" className="mt-2 inline-block text-sm font-medium text-brand-600 underline">
          {t('u.settings.to_merchant')}
        </Link>
      </Card>
    </div>
  );
}
