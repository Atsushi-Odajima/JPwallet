import { SETTLEMENT_CODES, type Merchant } from '@payccount/shared';
import { useMutation } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorText, Input, PageTitle, Select } from '../../components/ui';
import { useI18n, type MessageKey } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { useMerchant } from '../../lib/merchant';

const COUNTRY_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'JP', label: 'm.country.JP' },
  { value: 'US', label: 'm.country.US' },
  { value: 'GB', label: 'm.country.GB' },
  { value: 'DE', label: 'm.country.DE' },
  { value: 'SG', label: 'm.country.SG' },
];

/** 加盟店の新規登録（初回はダッシュボードの代わりに表示） */
export function OnboardPage({ first = false }: { first?: boolean }) {
  const { t } = useI18n();
  const { refresh, select } = useMerchant();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('JP');
  const [currency, setCurrency] = useState('JPY');
  const [website, setWebsite] = useState('');
  const create = useMutation({
    mutationFn: () => api.post<Merchant>('/me/merchants', { name, country, settlement_currency: currency, website_url: website }),
    onSuccess: async (m) => {
      select(m.id);
      await refresh();
      navigate('/merchant/developers');
    },
  });

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle sub={first ? t('m.onboard.sub_first') : t('m.onboard.sub_more')}>
        <span className="flex items-center gap-2">
          <Store className="h-5 w-5" /> {t('m.onboard.title')}
        </span>
      </PageTitle>
      <Card>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input label={t('m.field.store_name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('m.onboard.store_name_placeholder')} required maxLength={80} />
          <div className="grid grid-cols-2 gap-3">
            <Select label={t('m.field.country')} value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {t(c.label)}
                </option>
              ))}
            </Select>
            <Select label={t('m.field.settlement_currency')} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SETTLEMENT_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <Input label={t('m.onboard.website_optional')} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://shop.example" />
          <p className="text-xs text-slate-500">{t('m.onboard.note')}</p>
          <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
          <Button type="submit" loading={create.isPending} className="w-full">
            {t('m.onboard.submit')}
          </Button>
        </form>
      </Card>
    </div>
  );
}
