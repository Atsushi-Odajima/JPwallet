import { SETTLEMENT_CODES, type Merchant } from '@payccount/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, Input, PageTitle, Row, Select, SuccessText } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { merchantPath, useMerchant } from '../../lib/merchant';

/** /merchant/settings — 店舗名、精算通貨、国 */
export function MerchantSettingsPage() {
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
      <PageTitle>設定</PageTitle>
      <Card title="店舗情報">
        <form
          className="max-w-md space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSaved(false);
            save.mutate();
          }}
        >
          <Input label="店舗名" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          <Select label="国" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="JP">日本 (JP)</option>
            <option value="US">アメリカ (US)</option>
            <option value="GB">イギリス (GB)</option>
            <option value="DE">ドイツ (DE)</option>
            <option value="SG">シンガポール (SG)</option>
          </Select>
          <Select label="精算通貨（決済実績があると変更できません）" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SETTLEMENT_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input label="サイト URL" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://shop.example" />
          <ErrorText>{save.error ? errorMessage(save.error) : null}</ErrorText>
          <SuccessText>{saved ? '保存しました' : null}</SuccessText>
          <Button type="submit" loading={save.isPending}>
            保存
          </Button>
        </form>
      </Card>
      <Card title="加盟店情報">
        <Row label="加盟店ID" value={merchant.id} mono />
        <Row label="決済手数料" value={`${merchant.fee_bps / 100}%（fee_revenue 勘定へ）`} />
        <Row label="オーナー" value={merchant.owner_user_id} mono />
      </Card>
    </div>
  );
}
