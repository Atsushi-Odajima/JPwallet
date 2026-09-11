import { ArrowLeftRight, Bitcoin, Clock, Home, Settings, Sparkles, Wallet } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { DemoBanner } from '../components/DemoBanner';

const NAV = [
  { to: '/', label: 'ホーム', icon: Home },
  { to: '/topup', label: 'チャージ', icon: Wallet },
  { to: '/exchange', label: '両替', icon: ArrowLeftRight },
  { to: '/crypto', label: 'クリプト', icon: Bitcoin },
  { to: '/points', label: 'ポイント', icon: Sparkles },
  { to: '/history', label: '履歴', icon: Clock },
  { to: '/settings', label: '設定', icon: Settings },
];

/** ユーザー向けレイアウト（モバイルファースト、下部ナビ） */
export function UserLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <DemoBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-bold text-brand-800">
            <img src="/icons/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
            payCcount
          </NavLink>
          <NavLink to="/merchant" className="text-xs font-medium text-slate-500 hover:text-brand-600">
            加盟店ダッシュボード →
          </NavLink>
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
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
