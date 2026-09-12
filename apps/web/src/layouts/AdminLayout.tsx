import { Activity, BookText, CreditCard, LayoutDashboard, Scale, Sparkles, Store, Users, Wallet, Webhook } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { LocaleSwitch, useI18n, type MessageKey } from '../i18n';
import { useAuth } from '../lib/auth-context';

const NAV: { to: string; label: MessageKey; icon: typeof Users; end?: boolean }[] = [
  { to: '/admin', label: 'nav.a.overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'nav.a.users', icon: Users },
  { to: '/admin/merchants', label: 'nav.a.merchants', icon: Store },
  { to: '/admin/payments', label: 'nav.a.payments', icon: CreditCard },
  { to: '/admin/ledger', label: 'nav.a.ledger', icon: Scale },
  { to: '/admin/webhooks', label: 'nav.a.webhooks', icon: Webhook },
  { to: '/admin/campaigns', label: 'nav.a.campaigns', icon: Sparkles },
  { to: '/admin/audit', label: 'nav.a.audit', icon: BookText },
];

/** 管理者（運営）向けレイアウト — 全ユーザー・加盟店・台帳・Webhook を閲覧できる。PC はサイドバー、スマホは上部タブ */
export function AdminLayout() {
  const { session } = useAuth();
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/admin" className="flex shrink-0 items-center gap-2 font-bold">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
            payCcount <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">{t('badge.admin')}</span>
          </NavLink>
          <div className="flex min-w-0 items-center gap-3 text-xs text-slate-400">
            <span className="hidden items-center gap-1 sm:flex">
              <Activity className="h-3.5 w-3.5 text-emerald-400" /> {session?.email}
            </span>
            <LocaleSwitch dark />
            <NavLink to="/" className="flex shrink-0 items-center gap-1 whitespace-nowrap font-medium text-brand-300 hover:underline">
              <Wallet className="h-4 w-4" /> {t('nav.to_wallet')}
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
                <Icon className="h-4 w-4" /> {t(label)}
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
                {t(label)}
              </NavLink>
            ))}
          </nav>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
