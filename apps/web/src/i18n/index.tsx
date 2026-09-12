import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { messages, type MessageKey } from './messages';

/**
 * 軽量 i18n。
 *   - 言語は `?lang=ja|en` → localStorage → ブラウザ言語 の順に決める（日本語以外は英語）
 *   - React では useI18n().t、React 外（lib/api など）では t() を使う
 *   - 文言は i18n/messages/*.ts。{name} をパラメータとして置換する
 */
export type Locale = 'ja' | 'en';
export type Params = Record<string, string | number>;
export type TFunction = (key: MessageKey, params?: Params) => string;

const STORAGE_KEY = 'payccount.locale';
export const LOCALES: Locale[] = ['ja', 'en'];

function isLocale(v: unknown): v is Locale {
  return v === 'ja' || v === 'en';
}

export function detectLocale(): Locale {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (isLocale(q)) {
      localStorage.setItem(STORAGE_KEY, q);
      return q;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* localStorage が使えない環境 */
  }
  const lang = typeof navigator !== 'undefined' ? (navigator.language || '').toLowerCase() : 'ja';
  return lang.startsWith('ja') ? 'ja' : 'en';
}

let currentLocale: Locale = detectLocale();

/** 現在の言語（React 外から参照する用） */
export function getLocale(): Locale {
  return currentLocale;
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const raw = messages[locale][key] ?? messages.ja[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m));
}

/** React 外用の翻訳関数（現在の言語） */
export const t: TFunction = (key, params) => translate(currentLocale, key, params);

/** Intl 用のロケールタグ */
export function intlLocale(locale: Locale = currentLocale): string {
  return locale === 'ja' ? 'ja-JP' : 'en-US';
}

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nState | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);
  const setLocale = useCallback((l: Locale) => {
    currentLocale = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    setLocaleState(l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, 'app.title');
  }, [locale]);

  const value = useMemo<I18nState>(() => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('LocaleProvider が必要です');
  return ctx;
}

/** 言語切替（JA / EN）。ヘッダーに置く小さなトグル */
export function LocaleSwitch({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div role="group" aria-label={t('locale.label')} className={`inline-flex shrink-0 overflow-hidden rounded-lg border text-[11px] font-semibold ${dark ? 'border-slate-700' : 'border-slate-300'} ${className}`}>
      {LOCALES.map((l) => {
        const active = locale === l;
        return (
          <button
            key={l}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(l)}
            className={`px-2 py-1 transition ${active ? 'bg-brand-500 text-white' : dark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {l === 'ja' ? 'JA' : 'EN'}
          </button>
        );
      })}
    </div>
  );
}

export type { MessageKey } from './messages';
