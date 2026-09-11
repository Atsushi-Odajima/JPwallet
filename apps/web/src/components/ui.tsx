import { Loader2 } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  const base =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
  const styles: Record<Variant, string> = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="min-w-0 text-sm font-semibold text-slate-700">{title}</h2>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Input({ className = '', label, hint, error, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string; error?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>}
      <input
        className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-brand-300 ${
          error ? 'border-rose-400' : 'border-slate-300'
        } ${className}`}
        {...rest}
      />
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export function Select({ className = '', label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>}
      <select
        className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-300 ${className}`}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-8 text-slate-400 ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin" aria-label="読み込み中" />
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{children}</p>;
}

export function SuccessText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{children}</p>;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    blue: 'bg-brand-100 text-brand-700',
  };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function PageTitle({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-slate-900">{children}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
export function Row({ label, value, mono = false }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right text-slate-800 ${mono ? 'font-mono text-xs break-all' : ''}`}>{value}</span>
    </div>
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function CopyButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
      onClick={() => navigator.clipboard?.writeText(text)}
    >
      コピー
    </button>
  );
}
