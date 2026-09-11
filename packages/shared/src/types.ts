import type { CurrencyCode, CurrencyKind } from './currencies';

/** 金額は最小単位の整数を文字列で表す（例: JPY 1500 → "1500", USD 15.00 → "1500"） */
export type MinorAmount = string;

// ───────────────────────── 共通 ─────────────────────────

export type ApiErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'insufficient_funds'
  | 'not_found'
  | 'rate_limited'
  | 'idempotency_error'
  | 'api_error';

export interface ApiErrorBody {
  error: {
    type: ApiErrorType;
    code: string;
    message: string;
    param?: string;
  };
}

export interface Page<T> {
  data: T[];
  has_more: boolean;
}

// ───────────────────────── ウォレット（内部API） ─────────────────────────

export type UserRole = 'user' | 'admin';

export interface Profile {
  user_id: string;
  display_name: string | null;
  email: string | null;
  country: string;
  role: UserRole;
  created_at: string;
}

export interface Wallet {
  currency: CurrencyCode;
  kind: CurrencyKind;
  balance: MinorAmount;
  /** JPY 換算額（表示用） */
  jpy_value: MinorAmount;
}

export interface Me {
  profile: Profile;
  wallets: Wallet[];
  total_jpy: MinorAmount;
  merchant_ids: string[];
}

export type JournalType =
  | 'topup_card'
  | 'topup_bank'
  | 'points_purchase'
  | 'fx_convert'
  | 'crypto_buy'
  | 'crypto_sell'
  | 'crypto_deposit'
  | 'crypto_withdrawal'
  | 'payment'
  | 'refund'
  | 'payout'
  | 'fee'
  | 'adjustment';

export interface TransactionLine {
  currency: CurrencyCode;
  amount: MinorAmount;
}

export interface Transaction {
  id: string;
  type: JournalType;
  created_at: string;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  /** ログイン中ユーザー（または閲覧中口座）の増減 */
  lines: TransactionLine[];
}

export type TopupMethod = 'card' | 'bank_transfer';
export type TopupStatus = 'pending' | 'succeeded' | 'failed';

export interface Topup {
  id: string;
  user_id: string;
  method: TopupMethod;
  currency: CurrencyCode;
  amount: MinorAmount;
  status: TopupStatus;
  provider_ref: string | null;
  failure_reason: string | null;
  card_last4: string | null;
  card_brand: string | null;
  journal_id: string | null;
  created_at: string;
}

export interface VirtualBankAccount {
  id: string;
  user_id: string;
  bank_name: string;
  bank_code: string;
  branch_name: string;
  branch_code: string;
  account_type: string;
  account_number: string;
  holder_name: string;
  created_at: string;
}

export interface BankDepositNotification {
  id: string;
  virtual_account_id: string | null;
  account_number: string;
  amount: MinorAmount;
  currency: string;
  payer_name: string | null;
  external_ref: string | null;
  status: 'processed' | 'unmatched' | 'duplicate' | 'rejected';
  reject_reason: string | null;
  received_at: string;
  processed_at: string | null;
  topup_id: string | null;
  point_purchase_id: string | null;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface PointCampaign {
  id: string;
  name: string;
  bonus_rate: string; // "0.0100" = 1%
  min_amount: MinorAmount;
  active_from: string;
  active_to: string;
}

export type PointPurchaseMethod = 'card' | 'bank_transfer' | 'wallet_jpy';

export interface PointPurchase {
  id: string;
  user_id: string;
  paid_currency: 'JPY';
  paid_amount: MinorAmount;
  points_granted: MinorAmount;
  bonus_points: MinorAmount;
  payment_method: PointPurchaseMethod;
  status: 'pending' | 'succeeded' | 'failed';
  campaign_id: string | null;
  transfer_reference: string | null;
  journal_id: string | null;
  created_at: string;
}

export interface Rate {
  base: CurrencyCode;
  quote: CurrencyCode;
  rate: string;
  source: string;
  fetched_at: string;
}

export interface FxQuote {
  id: string;
  user_id: string;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  from_amount: MinorAmount;
  to_amount: MinorAmount;
  rate: string;
  mid_rate: string;
  spread_bps: number;
  expires_at: string;
  status: 'open' | 'executed' | 'expired';
  journal_id: string | null;
  created_at: string;
}

export interface CryptoPriceDetail {
  mid: string;
  buy: string;
  sell: string;
}

export interface CryptoPrices {
  BTC: { JPY: string };
  ETH: { JPY: string };
  spread_bps: number;
  detail: { BTC: CryptoPriceDetail; ETH: CryptoPriceDetail };
  fetched_at: string;
}

export interface CryptoDepositAddress {
  asset: 'BTC' | 'ETH';
  address: string;
  network: string;
  demo: true;
}

export interface CryptoDeposit {
  id: string;
  user_id: string;
  asset: 'BTC' | 'ETH';
  amount: MinorAmount;
  to_address: string;
  from_address: string | null;
  fake_tx_hash: string;
  status: string;
  journal_id: string | null;
  created_at: string;
}

export interface CryptoOrder {
  id: string;
  user_id: string;
  side: 'buy' | 'sell';
  asset: 'BTC' | 'ETH';
  quote_currency: 'JPY';
  asset_amount: MinorAmount;
  quote_amount: MinorAmount;
  price: string;
  spread_bps: number;
  status: 'filled' | 'failed';
  journal_id: string | null;
  created_at: string;
}

export interface CryptoWithdrawal {
  id: string;
  user_id: string;
  asset: 'BTC' | 'ETH';
  amount: MinorAmount;
  to_address: string;
  fake_tx_hash: string;
  status: 'confirmed';
  journal_id: string | null;
  created_at: string;
}

// ───────────────────────── 加盟店 / 決済 ─────────────────────────

export interface Merchant {
  id: string;
  name: string;
  country: string;
  settlement_currency: CurrencyCode;
  owner_user_id: string;
  website_url: string | null;
  fee_bps: number;
  created_at: string;
}

export interface ApiKey {
  id: string;
  merchant_id: string;
  prefix: string;
  mode: 'test';
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** 発行時のみ返る平文キー */
  key?: string;
}

export type CheckoutSessionStatus = 'open' | 'completed' | 'expired' | 'canceled';

export interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  merchant_id: string;
  status: CheckoutSessionStatus;
  url: string;
  amount: MinorAmount;
  currency: CurrencyCode;
  order_id: string | null;
  description: string | null;
  success_url: string;
  cancel_url: string;
  accepted_sources: CurrencyCode[];
  metadata: Record<string, unknown>;
  payment_id: string | null;
  expires_at: string;
  created_at: string;
  demo: true;
}

export type PaymentStatus = 'succeeded' | 'refunded' | 'partially_refunded';

export interface Payment {
  id: string;
  object: 'payment';
  merchant_id: string;
  session_id: string;
  order_id: string | null;
  description: string | null;
  source_currency: CurrencyCode;
  source_amount: MinorAmount;
  settlement_currency: CurrencyCode;
  settlement_amount: MinorAmount;
  /** 1 source = fx_rate settlement（スプレッド込みの実効レート） */
  fx_rate: string;
  mid_rate: string;
  spread_bps: number;
  fee_amount: MinorAmount;
  fee_bps: number;
  net_amount: MinorAmount;
  status: PaymentStatus;
  refunded_amount: MinorAmount;
  refunded_source_amount: MinorAmount;
  metadata: Record<string, unknown>;
  created_at: string;
  demo: true;
}

export interface Refund {
  id: string;
  object: 'refund';
  payment_id: string;
  amount: MinorAmount;
  currency: CurrencyCode;
  source_currency: CurrencyCode;
  source_amount: MinorAmount;
  reason: string | null;
  status: 'succeeded';
  created_at: string;
  demo: true;
}

export interface BalanceAmount {
  currency: CurrencyCode;
  amount: MinorAmount;
}

export interface Balance {
  object: 'balance';
  available: BalanceAmount[];
  pending: BalanceAmount[];
  demo: true;
}

export interface BalanceTransaction {
  id: string;
  journal_id: string;
  type: JournalType;
  currency: CurrencyCode;
  amount: MinorAmount;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
}

export type WebhookEventType =
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'payment.succeeded'
  | 'payment.refunded'
  | 'payout.paid';

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment.succeeded',
  'payment.refunded',
  'payout.paid',
];

export interface WebhookEndpoint {
  id: string;
  object: 'webhook_endpoint';
  merchant_id: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  created_at: string;
  /** 作成時のみ返る */
  secret?: string;
}

export type WebhookDeliveryStatus = 'pending' | 'in_flight' | 'delivered' | 'failed';

export interface WebhookDelivery {
  id: string;
  event_id: string;
  endpoint_id: string;
  url: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  next_retry_at: string | null;
  last_status_code: number | null;
  last_response_body: string | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface WebhookEvent<T = unknown> {
  id: string;
  object: 'event';
  type: WebhookEventType;
  created: number;
  created_at: string;
  demo: true;
  data: { object: T };
  deliveries?: WebhookDelivery[];
}

export interface ApiRequestLog {
  id: string;
  merchant_id: string;
  api_key_id: string | null;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  request_id: string;
  created_at: string;
}

// ───────────────────────── Checkout ページ（ユーザー側） ─────────────────────────

export interface CheckoutSourceOption {
  currency: CurrencyCode;
  /** この通貨で支払う場合の必要額 */
  amount: MinorAmount;
  /** ユーザーの残高 */
  balance: MinorAmount;
  sufficient: boolean;
  /** source→settlement の実効レート（スプレッド込み） */
  rate: string;
  /** 参考ミッドレート */
  mid_rate: string;
  spread_bps: number;
}

export interface CheckoutView {
  session: CheckoutSession;
  merchant: { id: string; name: string; country: string; website_url: string | null };
  sources: CheckoutSourceOption[];
  payment: Payment | null;
  /** 完了済み Session を、決済したユーザー本人が見ているか */
  is_payer: boolean;
}
