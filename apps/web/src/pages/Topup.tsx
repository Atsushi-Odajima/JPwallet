import { TEST_CARDS, formatAmount, parseAmount, type BankDepositNotification, type Page, type Topup, type VirtualBankAccount } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CreditCard } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Amount } from '../components/Amount';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorText, Input, PageTitle, Row, Spinner, SuccessText, formatDate } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useInvalidateWallet, useMe } from '../lib/queries';

type Tab = 'card' | 'bank';
const PRESETS = ['1000', '3000', '5000', '10000', '30000'];

/** /topup — カードチャージ / 銀行振込先表示（+ 開発モードの「入金をシミュレート」） */
export function TopupPage() {
  const [tab, setTab] = useState<Tab>('card');
  const me = useMe();
  const jpy = me.data?.wallets.find((w) => w.currency === 'JPY');

  return (
    <div className="space-y-4">
      <PageTitle sub={jpy ? <>現在の JPY 残高: <Amount value={jpy.balance} currency="JPY" /></> : undefined}>チャージ</PageTitle>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <button type="button" className={`flex items-center justify-center gap-1.5 rounded-lg py-2 ${tab === 'card' ? 'bg-white shadow' : 'text-slate-500'}`} onClick={() => setTab('card')}>
          <CreditCard className="h-4 w-4" /> カード
        </button>
        <button type="button" className={`flex items-center justify-center gap-1.5 rounded-lg py-2 ${tab === 'bank' ? 'bg-white shadow' : 'text-slate-500'}`} onClick={() => setTab('bank')}>
          <Building2 className="h-4 w-4" /> 銀行振込
        </button>
      </div>
      {tab === 'card' ? <CardTopup /> : <BankTopup />}
      <TopupHistory />
    </div>
  );
}

function CardTopup() {
  const invalidate = useInvalidateWallet();
  const [amount, setAmount] = useState('5000');
  const [number, setNumber] = useState<string>(TEST_CARDS.success);
  const [exp, setExp] = useState('12/30');
  const [cvc, setCvc] = useState('123');
  const [result, setResult] = useState<Topup | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      const minor = parseAmount(amount, 'JPY');
      return api.post<Topup>(
        '/me/topups/card',
        { amount: minor, currency: 'JPY', card: { number, exp, cvc } },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
    },
    onSuccess: (t) => {
      setResult(t);
      invalidate();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    m.mutate();
  };

  return (
    <Card title="模擬カードでチャージ">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">金額（JPY）</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className={`rounded-full border px-3 py-1 text-xs ${amount === p ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-600'}`}
              >
                {formatAmount(p, 'JPY')}
              </button>
            ))}
          </div>
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" hint="¥100 〜 ¥1,000,000" />
        </div>
        <Input label="カード番号" inputMode="numeric" autoComplete="cc-number" value={number} onChange={(e) => setNumber(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="有効期限 (MM/YY)" autoComplete="cc-exp" value={exp} onChange={(e) => setExp(e.target.value)} />
          <Input label="セキュリティコード" inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value)} />
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-medium">テスト用カード番号（デモでは実カードは使えません）</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" className="rounded border border-emerald-300 bg-white px-2 py-0.5 font-mono" onClick={() => setNumber(TEST_CARDS.success)}>
              {TEST_CARDS.success} → 成功
            </button>
            <button type="button" className="rounded border border-rose-300 bg-white px-2 py-0.5 font-mono" onClick={() => setNumber(TEST_CARDS.declined)}>
              {TEST_CARDS.declined} → 失敗
            </button>
          </div>
        </div>
        <ErrorText>{m.error ? errorMessage(m.error) : null}</ErrorText>
        {result && (
          <SuccessText>
            <Amount value={result.amount} currency="JPY" /> をチャージしました（{result.card_brand} ****{result.card_last4}）
          </SuccessText>
        )}
        <Button type="submit" className="w-full" loading={m.isPending}>
          チャージする
        </Button>
      </form>
    </Card>
  );
}

function BankTopup() {
  const qc = useQueryClient();
  const invalidate = useInvalidateWallet();
  const va = useQuery({
    queryKey: ['me', 'virtual-account'],
    queryFn: () => api.post<VirtualBankAccount>('/me/topups/bank/virtual-account'),
  });
  const deposits = useQuery({
    queryKey: ['me', 'bank-deposits'],
    queryFn: () => api.get<Page<BankDepositNotification>>('/me/topups/bank/deposits'),
    refetchInterval: 5_000,
  });
  const [amount, setAmount] = useState('10000');
  const [payer, setPayer] = useState('ヤマダ タロウ');
  const [message, setMessage] = useState<string | null>(null);

  const simulate = useMutation({
    mutationFn: async () => {
      const minor = parseAmount(amount, 'JPY');
      return api.post<{ status: string; topup: Topup | null }>('/mock/bank/deposit', {
        account_number: va.data!.account_number,
        amount: minor,
        payer_name: payer,
        external_ref: `SIM-${Date.now()}`,
      });
    },
    onSuccess: (r) => {
      setMessage(r.status === 'processed' ? '入金通知を受信し、残高に反映しました' : `結果: ${r.status}`);
      invalidate();
      qc.invalidateQueries({ queryKey: ['me', 'bank-deposits'] });
    },
  });

  if (va.isLoading) return <Spinner />;
  if (va.error) return <ErrorText>{errorMessage(va.error)}</ErrorText>;
  const v = va.data!;

  return (
    <div className="space-y-4">
      <Card title="あなた専用の振込先（模擬）">
        <p className="mb-2 text-xs text-slate-500">この口座に振り込むと、銀行からの入金通知を照合して自動で JPY 残高に反映します。</p>
        <Row label="銀行名" value={`${v.bank_name}（${v.bank_code}）`} />
        <Row label="支店" value={`${v.branch_name}（${v.branch_code}）`} />
        <Row label="口座種別" value={v.account_type} />
        <Row
          label="口座番号"
          value={
            <span className="flex items-center gap-2 font-mono text-base font-semibold">
              {v.account_number} <CopyButton text={v.account_number} />
            </span>
          }
        />
        <Row label="口座名義" value={v.holder_name} />
      </Card>

      <Card title="入金をシミュレート（開発モード）">
        <p className="mb-3 text-xs text-slate-500">
          銀行側の「入金通知」を模擬的に発生させます。通知受信 → 振込先照合 → 冪等チェック → 仕訳 → 通知の流れで処理されます。
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            simulate.mutate();
          }}
        >
          <Input label="振込金額（JPY）" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="振込人名" value={payer} onChange={(e) => setPayer(e.target.value)} />
          <ErrorText>{simulate.error ? errorMessage(simulate.error) : null}</ErrorText>
          <SuccessText>{message}</SuccessText>
          <Button type="submit" variant="secondary" className="w-full" loading={simulate.isPending}>
            入金通知を発生させる
          </Button>
        </form>
      </Card>

      <Card title="入金通知の履歴">
        {deposits.isLoading && <Spinner />}
        {deposits.data && deposits.data.data.length === 0 && <EmptyState>入金はまだありません</EmptyState>}
        {deposits.data && deposits.data.data.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {deposits.data.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{d.payer_name ?? '振込人不明'}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(d.received_at)} · 参照 {d.external_ref}
                  </p>
                </div>
                <div className="text-right">
                  <Amount value={d.amount} currency="JPY" className="font-semibold" />
                  <div>
                    <Badge tone={d.status === 'processed' ? 'green' : d.status === 'duplicate' ? 'amber' : 'red'}>
                      {d.status === 'processed' ? '反映済' : d.status === 'duplicate' ? '重複' : d.status === 'unmatched' ? '未照合' : '拒否'}
                    </Badge>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TopupHistory() {
  const q = useQuery({ queryKey: ['me', 'topups'], queryFn: () => api.get<Page<Topup>>('/me/topups?limit=10') });
  return (
    <Card title="チャージ履歴">
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>チャージ履歴はありません</EmptyState>}
      {q.data && q.data.data.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.data.map((t) => (
            <li key={t.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">{t.method === 'card' ? `カード ****${t.card_last4 ?? ''}` : '銀行振込'}</p>
                <p className="text-xs text-slate-500">{formatDate(t.created_at)}</p>
              </div>
              <div className="text-right">
                <Amount value={t.amount} currency={t.currency} className="font-semibold" />
                <div>
                  <Badge tone={t.status === 'succeeded' ? 'green' : t.status === 'failed' ? 'red' : 'amber'}>
                    {t.status === 'succeeded' ? '成功' : t.status === 'failed' ? '失敗' : '処理中'}
                  </Badge>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
