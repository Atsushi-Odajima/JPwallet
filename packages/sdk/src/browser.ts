/**
 * ブラウザ側ヘルパー（任意）。
 *   import { redirectToCheckout } from '@payccount/js/browser';
 *   redirectToCheckout(session.id, { appUrl: 'https://wallet.example' });
 */
const DEFAULT_APP_URL = 'http://localhost:5173';

export interface BrowserOptions {
  /** ウォレットアプリの URL（Checkout ページのホスト） */
  appUrl?: string;
}

/** Checkout Session の ID または URL から Checkout ページの URL を組み立てる */
export function checkoutUrl(sessionIdOrUrl: string, options: BrowserOptions = {}): string {
  if (/^https?:\/\//.test(sessionIdOrUrl)) return sessionIdOrUrl;
  const base = (options.appUrl ?? DEFAULT_APP_URL).replace(/\/$/, '');
  return `${base}/checkout/${encodeURIComponent(sessionIdOrUrl)}`;
}

/** Checkout ページへリダイレクトする */
export function redirectToCheckout(sessionIdOrUrl: string, options: BrowserOptions = {}): void {
  if (typeof window === 'undefined') throw new Error('redirectToCheckout はブラウザでのみ使えます');
  window.location.assign(checkoutUrl(sessionIdOrUrl, options));
}

export interface PayButtonOptions extends BrowserOptions {
  label?: string;
  className?: string;
  /** ボタン文言の言語（省略時はページの lang / ブラウザ言語。日本語以外は英語） */
  lang?: 'ja' | 'en';
}

/** 「payCcountで支払う」/ "Pay with payCcount" ボタンを描画する */
export function renderPayButton(container: HTMLElement, sessionIdOrUrl: string, options: PayButtonOptions = {}): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  const pageLang = (options.lang ?? (typeof document !== 'undefined' ? document.documentElement.lang : '') ?? '') || (typeof navigator !== 'undefined' ? navigator.language : 'ja');
  const isJa = pageLang.toLowerCase().startsWith('ja');
  btn.textContent = options.label ?? (isJa ? 'payCcountで支払う' : 'Pay with payCcount');
  btn.className = options.className ?? 'payccount-pay-button';
  if (!options.className) {
    btn.style.cssText =
      'display:inline-flex;align-items:center;gap:8px;background:#1e3a8a;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-weight:600;font-size:15px;cursor:pointer;font-family:system-ui,sans-serif';
  }
  btn.addEventListener('click', () => redirectToCheckout(sessionIdOrUrl, options));
  container.appendChild(btn);
  return btn;
}
