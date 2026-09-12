import { TEST_CARDS, formatAmount, parseAmount, type BankDepositNotification, type Page, type Topup, type VirtualBankAccount } from '@payccount/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CreditCard } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Amount } from '../components/Amount';
import { Badge, Button, Card, CopyButton, EmptyState, ErrorText, Input, PageTitle, Row, Spinner, SuccessText, formatDate } from '../components/ui';
import { useI18n } from '../i18n';
import { api, errorMessage } from '../lib/api';
import { useInvalidateWallet, useMe } from '../lib/queries';

type Tab = 'card' | 'bank';
const PRESETS = ['1000', '3000', '5000', '10000', '30000'];

/** /topup — カードチャージ / 銀行振込先表示（+ 開発モードの「入金をシミュレート」） */
export function TopupPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('card');
  const me = useMe();
  const jpy = me.data?.wallets.find((w) => w.currency === 'JPY');

  return (
    <div className="space-y-4">
      <PageTitle
        sub={
          jpy ? (
            <>
              {t('u.topup.current_jpy')}
              <Amount value={jpy.balance} currency="JPY" />
            </>
          ) : undefined
        }
      >
        {t('u.topup.title')}
      </PageTitle>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <button type="button" className={`flex items-center justify-center gap-1.5 rounded-lg py-2 ${tab === 'card' ? 'bg-white shadow' : 'text-slate-500'}`} onClick={() => setTab('card')}>
          <CreditCard className="h-4 w-4" /> {t('u.topup.tab_card')}
        </button>
        <button type="button" className={`flex items-center justify-center gap-1.5 rounded-lg py-2 ${tab === 'bank' ? 'bg-white shadow' : 'text-slate-500'}`} onClick={() => setTab('bank')}>
          <Building2 className="h-4 w-4" /> {t('u.topup.tab_bank')}
        </button>
      </div>
      {tab === 'card' ? <CardTopup /> : <BankTopup />}
      <TopupHistory />
    </div>
  );
}

function CardTopup() {
  const { t } = useI18n();
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
    onSuccess: (res) => {
      setResult(res);
      invalidate();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    m.mutate();
  };

  return (
    <Card title={t('u.topup.card_title')}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">{t('u.topup.amount_label')}</span>
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
          <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" hint={t('u.topup.amount_hint')} />
        </div>
        <Input label={t('u.topup.card_number')} inputMode="numeric" autoComplete="cc-number" value={number} onChange={(e) => setNumber(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('u.topup.card_exp')} autoComplete="cc-exp" value={exp} onChange={(e) => setExp(e.target.value)} />
          <Input label={t('u.topup.card_cvc')} inputMode="numeric" autoComplete="cc-csc" value={cvc} onChange={(e) => setCvc(e.target.value)} />
        </div>
        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <p className="font-medium">{t('u.topup.test_cards')}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <button type="button" className="rounded border border-emerald-300 bg-white px-2 py-0.5 font-mono" onClick={() => setNumber(TEST_CARDS.success)}>
              {t('u.topup.test_success', { number: TEST_CARDS.success })}
            </button>
            <button type="button" className="rounded border border-rose-300 bg-white px-2 py-0.5 font-mono" onClick={() => setNumber(TEST_CARDS.declined)}>
              {t('u.topup.test_declined', { number: TEST_CARDS.declined })}
            </button>
          </div>
        </div>
        <ErrorText>{m.error ? errorMessage(m.error) : null}</ErrorText>
        {result && (
          <SuccessText>
            <Amount value={result.amount} currency="JPY" />
            {t('u.topup.card_success', { brand: result.card_brand ?? '', last4: result.card_last4 ?? '' })}
          </SuccessText>
        )}
        <Button type="submit" className="w-full" loading={m.isPending}>
          {t('u.topup.submit')}
        </Button>
      </form>
    </Card>
  );
}

function BankTopup() {
  const { t } = useI18n();
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
  const [payer, setPayer] = useState(t('u.topup.sim_payer_default'));
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
      setMessage(r.status === 'processed' ? t('u.topup.sim_processed') : t('u.topup.sim_result', { status: r.status }));
      invalidate();
      qc.invalidateQueries({ queryKey: ['me', 'bank-deposits'] });
    },
  });

  if (va.isLoading) return <Spinner />;
  if (va.error) return <ErrorText>{errorMessage(va.error)}</ErrorText>;
  const v = va.data!;

  return (
    <div className="space-y-4">
      <Card title={t('u.topup.va_title')}>
        <p className="mb-2 text-xs text-slate-500">{t('u.topup.va_desc')}</p>
        <Row label={t('u.topup.bank_name')} value={t('u.topup.name_code', { name: v.bank_name, code: v.bank_code })} />
        <Row label={t('u.topup.branch')} value={t('u.topup.name_code', { name: v.branch_name, code: v.branch_code })} />
        <Row label={t('u.topup.account_type')} value={v.account_type} />
        <Row
          label={t('u.topup.account_number')}
          value={
            <span className="flex items-center gap-2 font-mono text-base font-semibold">
              {v.account_number} <CopyButton text={v.account_number} />
            </span>
          }
        />
        <Row label={t('u.topup.holder')} value={v.holder_name} />
      </Card>

      <Card title={t('u.topup.sim_title')}>
        <p className="mb-3 text-xs text-slate-500">{t('u.topup.sim_desc')}</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            simulate.mutate();
          }}
        >
          <Input label={t('u.topup.sim_amount')} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label={t('u.topup.sim_payer')} value={payer} onChange={(e) => setPayer(e.target.value)} />
          <ErrorText>{simulate.error ? errorMessage(simulate.error) : null}</ErrorText>
          <SuccessText>{message}</SuccessText>
          <Button type="submit" variant="secondary" className="w-full" loading={simulate.isPending}>
            {t('u.topup.sim_submit')}
          </Button>
        </form>
      </Card>

      <Card title={t('u.topup.deposits_title')}>
        {deposits.isLoading && <Spinner />}
        {deposits.data && deposits.data.data.length === 0 && <EmptyState>{t('u.topup.no_deposits')}</EmptyState>}
        {deposits.data && deposits.data.data.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {deposits.data.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium">{d.payer_name ?? t('u.topup.unknown_payer')}</p>
                  <p className="text-xs text-slate-500">{t('u.topup.deposit_ref', { date: formatDate(d.received_at), ref: d.external_ref ?? '' })}</p>
                </div>
                <div className="text-right">
                  <Amount value={d.amount} currency="JPY" className="font-semibold" />
                  <div>
                    <Badge tone={d.status === 'processed' ? 'green' : d.status === 'duplicate' ? 'amber' : 'red'}>
                      {d.status === 'processed'
                        ? t('u.topup.deposit_status.processed')
                        : d.status === 'duplicate'
                          ? t('u.topup.deposit_status.duplicate')
                          : d.status === 'unmatched'
                            ? t('u.topup.deposit_status.unmatched')
                            : t('u.topup.deposit_status.rejected')}
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
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['me', 'topups'], queryFn: () => api.get<Page<Topup>>('/me/topups?limit=10') });
  return (
    <Card title={t('u.topup.history_title')}>
      {q.isLoading && <Spinner />}
      {q.data && q.data.data.length === 0 && <EmptyState>{t('u.topup.no_history')}</EmptyState>}
      {q.data && q.data.data.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.data.map((tp) => (
            <li key={tp.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium">{tp.method === 'card' ? t('u.topup.method_card', { last4: tp.card_last4 ?? '' }) : t('u.topup.tab_bank')}</p>
                <p className="text-xs text-slate-500">{formatDate(tp.created_at)}</p>
              </div>
              <div className="text-right">
                <Amount value={tp.amount} currency={tp.currency} className="font-semibold" />
                <div>
                  <Badge tone={tp.status === 'succeeded' ? 'green' : tp.status === 'failed' ? 'red' : 'amber'}>
                    {tp.status === 'succeeded' ? t('u.topup.status.succeeded') : tp.status === 'failed' ? t('u.topup.status.failed') : t('u.topup.status.pending')}
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
