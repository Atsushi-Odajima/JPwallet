import { SETTLEMENT_CODES, type Merchant } from '@payccount/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, Input, PageTitle, Row, Select, SuccessText } from '../../components/ui';
import { useI18n, type MessageKey } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { merchantPath, useMerchant } from '../../lib/merchant';

const COUNTRY_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'JP', label: 'm.country.JP' },
  { value: 'US', label: 'm.country.US' },
  { value: 'GB', label: 'm.country.GB' },
  { value: 'DE', label: 'm.country.DE' },
  { value: 'SG', label: 'm.country.SG' },
];

/** /merchant/settings — 店舗名、精算通貨、国 */
export function MerchantSettingsPage() {
  const { t } = useI18n();
  const { merchant, refresh } = useMerchant();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('JP');
  const [currency, setCurrency] = useState('JPY');
  const [website, setWebsite] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (merchant) {
      setName(merchant.name);
      setCountry(merchant.country);
      setCurrency(merchant.settlement_currency);
      setWebsite(merchant.website_url ?? '');
    }
  }, [merchant]);

  const save = useMutation({
    mutationFn: () => api.patch<Merchant>(merchantPath(merchant!.id), { name, country, settlement_currency: currency, website_url: website }),
    onSuccess: async () => {
      setSaved(true);
      await refresh();
    },
  });
  if (!merchant) return null;

  return (
    <div className="space-y-4">
      <PageTitle>{t('m.settings.title')}</PageTitle>
      <Card title={t('m.settings.store_info')}>
        <form
          className="max-w-md space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSaved(false);
            save.mutate();
          }}
        >
          <Input label={t('m.field.store_name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          <Select label={t('m.field.country')} value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {t(c.label)}
              </option>
            ))}
          </Select>
          <Select label={t('m.settings.settlement_currency_locked')} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SETTLEMENT_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input label={t('m.settings.website')} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://shop.example" />
          <ErrorText>{save.error ? errorMessage(save.error) : null}</ErrorText>
          <SuccessText>{saved ? t('m.settings.saved') : null}</SuccessText>
          <Button type="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </Card>
      <Card title={t('m.settings.merchant_info')}>
        <Row label={t('m.settings.merchant_id')} value={merchant.id} mono />
        <Row label={t('m.settings.fee')} value={t('m.settings.fee_value', { pct: merchant.fee_bps / 100 })} />
        <Row label={t('m.settings.owner')} value={merchant.owner_user_id} mono />
      </Card>
    </div>
  );
}
