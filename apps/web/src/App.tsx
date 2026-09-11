import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { MerchantLayout } from './layouts/MerchantLayout';
import { UserLayout } from './layouts/UserLayout';
import { CheckoutPage } from './pages/Checkout';
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
import { MerchantDevelopersPage } from './pages/merchant/Developers';
import { MerchantDocsPage } from './pages/merchant/Docs';
import { OnboardPage } from './pages/merchant/Onboard';
import { MerchantOverviewPage } from './pages/merchant/Overview';
import { MerchantPaymentsPage } from './pages/merchant/Payments';
import { MerchantSettingsPage } from './pages/merchant/Settings';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* 加盟店決済ページ（未ログインならログイン後に戻る） */}
        <Route
          path="/checkout/:sessionId"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />

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

        {/* 加盟店ダッシュボード（PC 向け） */}
        <Route
          path="/merchant"
          element={
            <RequireAuth>
              <MerchantLayout />
            </RequireAuth>
          }
        >
          <Route index element={<MerchantOverviewPage />} />
          <Route path="payments" element={<MerchantPaymentsPage />} />
          <Route path="developers" element={<MerchantDevelopersPage />} />
          <Route path="docs" element={<MerchantDocsPage />} />
          <Route path="settings" element={<MerchantSettingsPage />} />
          <Route path="onboard" element={<OnboardPage />} />
        </Route>

        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
