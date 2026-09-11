import type { Profile } from '@payccount/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { DemoFooter } from '../components/DemoBanner';
import { Button, Card, ErrorText, Input, PageTitle, Row, Select, Spinner, SuccessText } from '../components/ui';
import { API_URL, api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useInvalidateWallet, useMe } from '../lib/queries';

/** /settings — プロフィール、認証情報、ログアウト */
export function SettingsPage() {
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
      <PageTitle>設定</PageTitle>
      <Card title="プロフィール">
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSaved(false);
            save.mutate();
          }}
        >
          <Input label="表示名" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          <Select label="国" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="JP">日本 (JP)</option>
            <option value="US">アメリカ (US)</option>
            <option value="GB">イギリス (GB)</option>
            <option value="DE">ドイツ (DE)</option>
          </Select>
          <ErrorText>{save.error ? errorMessage(save.error) : null}</ErrorText>
          <SuccessText>{saved ? '保存しました' : null}</SuccessText>
          <Button type="submit" loading={save.isPending}>
            保存
          </Button>
        </form>
      </Card>

      <Card title="アカウント">
        <Row label="メール" value={profile?.email ?? session?.email ?? '-'} />
        <Row label="ユーザーID" value={profile?.user_id ?? '-'} mono />
        <Row label="ロール" value={profile?.role === 'admin' ? '管理者' : '一般ユーザー'} />
        <Row label="認証方式" value={adapter.mode === 'supabase' ? 'Supabase Auth（メール OTP）' : 'デモ認証（メールのみ）'} />
        <Row label="API" value={API_URL} mono />
        {profile?.role === 'admin' && (
          <Link to="/admin" className="mt-2 inline-block text-sm font-medium text-brand-600 underline">
            管理画面を開く →
          </Link>
        )}
        <div className="mt-4">
          <Button variant="danger" onClick={() => signOut()}>
            ログアウト
          </Button>
        </div>
      </Card>

      <Card title="加盟店として使う">
        <p className="text-sm text-slate-600">EC サイトに payCcount 決済を組み込む場合は、加盟店ダッシュボードで店舗を登録し APIキーを発行します。</p>
        <Link to="/merchant" className="mt-2 inline-block text-sm font-medium text-brand-600 underline">
          加盟店ダッシュボードへ →
        </Link>
      </Card>
      <DemoFooter />
    </div>
  );
}
