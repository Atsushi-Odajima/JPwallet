import { formatAmount, type FormatOptions } from '@payccount/shared';

interface Props extends FormatOptions {
  value: string;
  currency: string;
  className?: string;
  /** 正負で色を付ける */
  colored?: boolean;
}

/** 金額表示。必ず packages/shared の formatAmount を通す */
export function Amount({ value, currency, className = '', colored = false, ...opts }: Props) {
  let text: string;
  try {
    text = formatAmount(value, currency, opts);
  } catch {
    text = `${value} ${currency}`;
  }
  const neg = value.startsWith('-');
  const color = colored ? (neg ? 'text-rose-600' : 'text-emerald-600') : '';
  return <span className={`tabular ${color} ${className}`}>{text}</span>;
}
