import { Activity, BookText, CreditCard, LayoutDashboard, Scale, Sparkles, Store, Users, Wallet, Webhook } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';

const NAV = [
  { to: '/admin', label: '概要', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'ユーザー', icon: Users },
  { to: '/admin/merchants', label: '加盟店', icon: Store },
  { to: '/admin/payments', label: '決済', icon: CreditCard },
  { to: '/admin/ledger', label: '台帳', icon: Scale },
  { to: '/admin/webhooks', label: 'Webhook', icon: Webhook },
  { to: '/admin/campaigns', label: 'キャンペーン', icon: Sparkles },
  { to: '/admin/audit', label: '監査ログ', icon: BookText },
];

/** 管理者（運営）向けレイアウト — 全ユーザー・加盟店・台帳・Webhook を閲覧できる。PC はサイドバー、スマホは上部タブ */
export function AdminLayout() {
  const { session } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/admin" className="flex shrink-0 items-center gap-2 font-bold">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
            payCcount <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">管理者</span>
          </NavLink>
          <div className="flex min-w-0 items-center gap-3 text-xs text-slate-400">
            <span className="hidden items-center gap-1 sm:flex">
              <Activity className="h-3.5 w-3.5 text-emerald-400" /> {session?.email}
            </span>
            <NavLink to="/" className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-brand-300 hover:underline">
              <Wallet className="h-4 w-4" /> ウォレットへ
            </NavLink>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-4 sm:py-6">
        <aside className="hidden w-48 shrink-0 md:block">
          <nav className="space-y-1">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`
                }
              >
                <Icon className="h-4 w-4" /> {label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="admin-main min-w-0 flex-1">
          <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-1 md:hidden">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${isActive ? 'bg-brand-500 text-white' : 'bg-slate-800 text-slate-300'}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
