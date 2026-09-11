import { SETTLEMENT_CODES, type Merchant } from '@payccount/shared';
import { useMutation } from '@tanstack/react-query';
import { Store } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, ErrorText, Input, PageTitle, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useMerchant } from '../../lib/merchant';

/** 加盟店の新規登録（初回はダッシュボードの代わりに表示） */
export function OnboardPage({ first = false }: { first?: boolean }) {
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
      <PageTitle sub={first ? 'まだ加盟店がありません。店舗を登録すると APIキーを発行できます' : '複数の店舗（例: 国内EC と 海外EC）を登録できます'}>
        <span className="flex items-center gap-2">
          <Store className="h-5 w-5" /> 加盟店を登録
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
          <Input label="店舗名" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: デモ商店 / Global Shop" required maxLength={80} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="国" value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="JP">日本 (JP)</option>
              <option value="US">アメリカ (US)</option>
              <option value="GB">イギリス (GB)</option>
              <option value="DE">ドイツ (DE)</option>
              <option value="SG">シンガポール (SG)</option>
            </Select>
            <Select label="精算通貨" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {SETTLEMENT_CODES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <Input label="サイト URL（任意）" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://shop.example" />
          <p className="text-xs text-slate-500">お客様は JPY / PT / USD / EUR / GBP / BTC / ETH のどれでも支払えます。あなたには精算通貨で入金され、手数料 1.6% が差し引かれます。</p>
          <ErrorText>{create.error ? errorMessage(create.error) : null}</ErrorText>
          <Button type="submit" loading={create.isPending} className="w-full">
            登録して APIキーを発行する
          </Button>
        </form>
      </Card>
    </div>
  );
}
