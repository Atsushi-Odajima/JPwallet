import { BookOpen, Code2, CreditCard, LayoutDashboard, Settings, Store, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { Select, Spinner } from '../components/ui';
import { LocaleSwitch, useI18n, type MessageKey } from '../i18n';
import { useAuth } from '../lib/auth-context';
import { MerchantProvider, useMerchant } from '../lib/merchant';
import { OnboardPage } from '../pages/merchant/Onboard';

const NAV: { to: string; label: MessageKey; icon: typeof Store; end?: boolean }[] = [
  { to: '/merchant', label: 'nav.m.overview', icon: LayoutDashboard, end: true },
  { to: '/merchant/payments', label: 'nav.m.payments', icon: CreditCard },
  { to: '/merchant/developers', label: 'nav.m.developers', icon: Code2 },
  { to: '/merchant/docs', label: 'nav.m.docs', icon: BookOpen },
  { to: '/merchant/settings', label: 'nav.m.settings', icon: Settings },
];

/** 加盟店ダッシュボード（PC はサイドバー、スマホは上部タブ） */
export function MerchantLayout() {
  return (
    <MerchantProvider>
      <MerchantShell />
    </MerchantProvider>
  );
}

function MerchantShell() {
  const { merchants, merchant, loading, select } = useMerchant();
  const { session } = useAuth();
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <NavLink to="/merchant" className="flex shrink-0 items-center gap-2 font-bold text-brand-800">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
            payCcount <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">{t('badge.merchant')}</span>
          </NavLink>
          {/* 店舗の切替: スマホでは 2 行目に全幅で表示 */}
          {merchants.length > 0 && merchant && (
            <div className="order-last flex w-full items-center gap-2 sm:order-none sm:w-auto sm:flex-1 sm:justify-start">
              <Store className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1 sm:max-w-xs">
                <Select value={merchant.id} onChange={(e) => select(e.target.value)} className="py-1.5">
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}（{m.settlement_currency}）
                    </option>
                  ))}
                </Select>
              </div>
              <NavLink to="/merchant/onboard" className="shrink-0 whitespace-nowrap text-xs text-brand-600 underline">
                {t('nav.m.add')}
              </NavLink>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
            <span className="hidden sm:inline">{session?.email}</span>
            <LocaleSwitch />
            <NavLink to="/" className="flex items-center gap-1 whitespace-nowrap font-medium text-brand-600 hover:underline">
              <Wallet className="h-4 w-4" /> {t('nav.to_wallet')}
            </NavLink>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-4 sm:py-6">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav className="space-y-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:bg-white/60'}`
                }
              >
                <Icon className="h-4 w-4" /> {t(label)}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 md:hidden">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${isActive ? 'bg-brand-500 text-white' : 'bg-white text-slate-600'}`}
              >
                {t(label)}
              </NavLink>
            ))}
          </nav>
          {loading ? <Spinner /> : merchants.length === 0 ? <OnboardPage first /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
