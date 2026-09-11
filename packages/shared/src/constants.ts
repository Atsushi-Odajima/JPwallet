/** 全レイヤ共通の定数 */
export const APP_NAME = 'payCcount';
export const DEMO_NOTICE = 'これはデモアプリケーションです。';
export const DEMO_MODE_HEADER = 'X-Demo-Mode';
export const REQUEST_ID_HEADER = 'X-Request-Id';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const SIGNATURE_HEADER = 'X-payCcount-Signature';

/** テスト用カード番号 */
export const TEST_CARDS = {
  success: '4242424242424242',
  declined: '4000000000000002',
} as const;

/** デフォルトの手数料・期限（DB の config テーブルが正。ここは表示用） */
export const DEFAULTS = {
  merchantFeeBps: 160,
  fxSpreadBps: 50,
  cryptoSpreadBps: 100,
  checkoutSessionTtlMinutes: 30,
  fxQuoteTtlSeconds: 60,
  webhookRetryScheduleMinutes: [1, 5, 30, 120, 720],
} as const;

/** 管理者アカウント（デモ用固定値） */
export const ADMIN_LOGIN_ID = 'kuro';
export const ADMIN_EMAIL_DOMAIN = 'payccount.demo';
