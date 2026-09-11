import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { UserLayout } from './layouts/UserLayout';
import { CryptoPage } from './pages/Crypto';
import { ExchangePage } from './pages/Exchange';
import { HistoryPage } from './pages/History';
import { HomePage } from './pages/Home';
import { LoginPage } from './pages/Login';
import { NotFoundPage } from './pages/NotFound';
import { PointsPage } from './pages/Points';
import { SettingsPage } from './pages/Settings';
import { TopupPage } from './pages/Topup';
import { WalletPage } from './pages/Wallet';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* ユーザー向け（PWA・モバイルファースト） */}
        <Route
          element={
            <RequireAuth>
              <UserLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/wallet/:currency" element={<WalletPage />} />
          <Route path="/topup" element={<TopupPage />} />
          <Route path="/exchange" element={<ExchangePage />} />
          <Route path="/crypto" element={<CryptoPage />} />
          <Route path="/points" element={<PointsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
