import { BookOpen, Code2, CreditCard, LayoutDashboard, Settings, Store, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { DemoBanner } from '../components/DemoBanner';
import { Select, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth-context';
import { MerchantProvider, useMerchant } from '../lib/merchant';
import { OnboardPage } from '../pages/merchant/Onboard';

const NAV = [
  { to: '/merchant', label: '概要', icon: LayoutDashboard, end: true },
  { to: '/merchant/payments', label: '決済', icon: CreditCard },
  { to: '/merchant/developers', label: '開発者', icon: Code2 },
  { to: '/merchant/docs', label: 'ドキュメント', icon: BookOpen },
  { to: '/merchant/settings', label: '設定', icon: Settings },
];

/** 加盟店ダッシュボード（PC 向けサイドバーレイアウト） */
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

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <DemoBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <NavLink to="/merchant" className="flex items-center gap-2 font-bold text-brand-800">
              <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
              payCcount <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">加盟店</span>
            </NavLink>
            {merchants.length > 0 && merchant && (
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-slate-400" />
                <Select value={merchant.id} onChange={(e) => select(e.target.value)} className="py-1.5">
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}（{m.settlement_currency}）
                    </option>
                  ))}
                </Select>
                <NavLink to="/merchant/onboard" className="text-xs text-brand-600 underline">
                  + 追加
                </NavLink>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="hidden sm:inline">{session?.email}</span>
            <NavLink to="/" className="flex items-center gap-1 font-medium text-brand-600 hover:underline">
              <Wallet className="h-4 w-4" /> ウォレットへ
            </NavLink>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-6">
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
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">
          <nav className="mb-4 flex gap-1 overflow-x-auto md:hidden">
            {NAV.map(({ to, label, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${isActive ? 'bg-brand-500 text-white' : 'bg-white text-slate-600'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          {loading ? <Spinner /> : merchants.length === 0 ? <OnboardPage first /> : <Outlet />}
        </main>
      </div>
      <footer className="border-t border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500">これはデモアプリケーションです。実際の資金は扱いません。</footer>
    </div>
  );
}
