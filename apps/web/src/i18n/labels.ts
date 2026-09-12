import { CURRENCIES, formatAmount, type Notification, type Transaction } from '@payccount/shared';
import { hasMessage, type MessageKey } from './messages';
import { type Locale, type TFunction } from './index';

/**
 * データ由来の値（種別コード・状態・システム勘定・通知・取引説明）を表示文言に変換するヘルパー。
 * 画面からは useI18n() の t を渡して使う。
 */
function keyed(t: TFunction, prefix: string, value: string): string {
  const key = `${prefix}.${value}`;
  return hasMessage(key) ? t(key as MessageKey) : value;
}

/** 仕訳種別（topup_card → カードチャージ / Card top-up） */
export function journalTypeLabel(t: TFunction, type: string): string {
  return keyed(t, 'journal', type);
}

export type BadgeTone = 'slate' | 'green' | 'amber' | 'red' | 'blue';

/** 決済状態の文言と色 */
export function paymentStatusLabel(t: TFunction, status: string): { label: string; tone: BadgeTone } {
  const tone: BadgeTone = status === 'succeeded' ? 'green' : status === 'partially_refunded' ? 'amber' : status === 'refunded' ? 'slate' : 'slate';
  return { label: keyed(t, 'payment_status', status), tone };
}

/** Checkout Session の状態 */
export function sessionStatusLabel(t: TFunction, status: string): { label: string; tone: BadgeTone } {
  const tone: BadgeTone = status === 'completed' ? 'green' : status === 'open' ? 'amber' : 'slate';
  return { label: keyed(t, 'session_status', status), tone };
}

/** Webhook 配信の状態 */
export function deliveryStatusLabel(t: TFunction, status: string): { label: string; tone: BadgeTone } {
  const tone: BadgeTone = status === 'delivered' ? 'green' : status === 'failed' ? 'red' : 'amber';
  return { label: keyed(t, 'delivery_status', status), tone };
}

/** チャージの状態 */
export function topupStatusLabel(t: TFunction, status: string): { label: string; tone: BadgeTone } {
  const tone: BadgeTone = status === 'succeeded' ? 'green' : status === 'failed' ? 'red' : 'amber';
  return { label: keyed(t, 'topup_status', status), tone };
}

/** システム勘定（fx_pool → 為替プール / FX pool） */
export function systemCodeLabel(t: TFunction, code: string): string {
  return keyed(t, 'system_code', code);
}

/** 通貨の表示名（日本円 / Japanese Yen） */
export function currencyName(locale: Locale, code: string): string {
  const def = (CURRENCIES as Record<string, { name: string; nameEn: string } | undefined>)[code];
  if (!def) return code;
  return locale === 'ja' ? def.name : def.nameEn;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function safeAmount(minor: unknown, currency: unknown): string {
  const m = str(minor);
  const c = str(currency);
  if (!m || !c) return `${m ?? ''} ${c ?? ''}`.trim();
  try {
    return formatAmount(m, c, { code: true, trimZeros: true });
  } catch {
    return `${m} ${c}`;
  }
}

/**
 * 取引の説明文。日本語はサーバーが metadata.description に入れた文言をそのまま使い、
 * 英語は metadata の構造化フィールドから組み立てる（無ければサーバーの文言）。
 */
export function describeTransaction(t: TFunction, locale: Locale, tx: Transaction): string {
  const meta = tx.metadata as Record<string, unknown>;
  const serverText = str(meta.description) ?? '';
  if (locale === 'ja') return serverText;
  switch (tx.type) {
    case 'topup_card':
      return t('tx.card_topup');
    case 'topup_bank':
      return t('tx.bank_transfer_from', { payer: str(meta.payer_name) ?? t('tx.unknown_payer') });
    case 'points_purchase': {
      const method = str(meta.method) ?? 'wallet_jpy';
      const bonus = str(meta.bonus_points);
      const methodKey = `tx.method.${method}`;
      return t('tx.points_purchase', {
        method: hasMessage(methodKey) ? t(methodKey as MessageKey) : method,
        bonus: bonus && bonus !== '0' ? t('tx.bonus', { n: bonus }) : '',
      });
    }
    case 'fx_convert':
      return `${str(meta.from_currency) ?? ''} → ${str(meta.to_currency) ?? ''}`;
    case 'crypto_buy':
      return t('tx.crypto_buy', { asset: str(meta.asset) ?? '' });
    case 'crypto_sell':
      return t('tx.crypto_sell', { asset: str(meta.asset) ?? '' });
    case 'crypto_deposit':
      return t('tx.crypto_deposit', { asset: str(meta.asset) ?? '' });
    case 'crypto_withdrawal':
      return t('tx.crypto_withdrawal', { asset: str(meta.asset) ?? '' });
    case 'payment':
      // 決済の説明は加盟店が付けた商品名 / 注文番号（データ）
      return str(meta.order_id) && serverText === '決済' ? String(meta.order_id) : serverText === '決済' ? t('tx.payment') : serverText;
    case 'refund': {
      // サーバーの文言「返金（<商品名 / 注文番号>）」から中身だけ取り出して使う
      const inner = /^返金（(.+)）$/.exec(serverText)?.[1];
      return t('tx.refund_of', { what: inner ?? str(meta.order_id) ?? str(meta.payment_id) ?? '' });
    }
    default:
      return serverText;
  }
}

/**
 * 通知の表示文言。日本語はサーバーの title / body、英語は type + data から組み立てる。
 */
export function notificationText(t: TFunction, locale: Locale, n: Notification): { title: string; body: string | null } {
  if (locale === 'ja') return { title: n.title, body: n.body };
  const d = (n.data ?? {}) as Record<string, unknown>;
  switch (n.type) {
    case 'topup_card':
      return { title: t('notif.topup_card.title'), body: t('notif.topup_card.body', { amount: safeAmount(d.amount, d.currency ?? 'JPY') }) };
    case 'topup_bank':
      return {
        title: t('notif.topup_bank.title'),
        body: t('notif.topup_bank.body', { amount: safeAmount(d.amount, d.currency ?? 'JPY'), payer: str(d.payer_name) ?? t('tx.unknown_payer') }),
      };
    case 'points_purchase': {
      const bonus = str(d.bonus);
      return {
        title: t('notif.points_purchase.title'),
        body: t('notif.points_purchase.body', { points: str(d.points) ?? '', bonus: bonus && bonus !== '0' ? t('notif.points_purchase.bonus', { n: bonus }) : '' }),
      };
    }
    case 'crypto_deposit':
      return { title: t('notif.crypto_deposit.title', { asset: str(d.asset) ?? '' }), body: t('notif.crypto_deposit.body') };
    case 'crypto_withdrawal':
      return {
        title: t('notif.crypto_withdrawal.title', { asset: str(d.asset) ?? '' }),
        body: t('notif.crypto_withdrawal.body', { amount: safeAmount(d.amount, d.asset), tx: str(d.tx_hash) ?? '' }),
      };
    case 'payment':
      return {
        title: t('notif.payment.title', { merchant: str(d.merchant_name) ?? '' }),
        body: t('notif.payment.body', { amount: safeAmount(d.source_amount, d.source_currency) }),
      };
    case 'refund':
      return {
        title: t('notif.refund.title'),
        body: t('notif.refund.body', { merchant: str(d.merchant_name) ?? t('common.merchant'), amount: safeAmount(d.source_amount, d.source_currency) }),
      };
    default:
      return { title: n.title, body: n.body };
  }
}
