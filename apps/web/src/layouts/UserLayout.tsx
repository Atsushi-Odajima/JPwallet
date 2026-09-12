import { ArrowLeftRight, Bitcoin, Clock, Home, Settings, Sparkles, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { NotificationBell } from '../components/NotificationBell';
import { LocaleSwitch, useI18n, type MessageKey } from '../i18n';

const NAV: { to: string; label: MessageKey; icon: typeof Home }[] = [
  { to: '/', label: 'nav.home', icon: Home },
  { to: '/topup', label: 'nav.topup', icon: Wallet },
  { to: '/exchange', label: 'nav.exchange', icon: ArrowLeftRight },
  { to: '/crypto', label: 'nav.crypto', icon: Bitcoin },
  { to: '/points', label: 'nav.points', icon: Sparkles },
  { to: '/history', label: 'nav.history', icon: Clock },
  { to: '/settings', label: 'nav.settings', icon: Settings },
];

/** ユーザー向けレイアウト（モバイルファースト、下部ナビ） */
export function UserLayout() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 font-bold text-brand-800">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
            payCcount
          </NavLink>
          <div className="flex min-w-0 items-center gap-2">
            <NavLink to="/merchant" className="truncate text-xs font-medium text-slate-500 hover:text-brand-600">
              {t('nav.merchant_dashboard')}
            </NavLink>
            <LocaleSwitch />
            <NotificationBell />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 pb-24">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur">
        <ul className="mx-auto flex max-w-2xl justify-between px-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive ? 'text-brand-600' : 'text-slate-500 hover:text-slate-800'}`
                }
              >
                <Icon className="h-5 w-5" aria-hidden />
                {t(label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
