/** API で使う接頭辞付き ID */
export const ID_PREFIX = {
  checkoutSession: 'cs_',
  payment: 'pay_',
  refund: 're_',
  event: 'evt_',
  webhookEndpoint: 'wh_',
  webhookDelivery: 'whd_',
  fxQuote: 'qt_',
  apiKeyTest: 'sk_test_',
  webhookSecret: 'whsec_',
} as const;

export function hasPrefix(id: unknown, prefix: string): id is string {
  return typeof id === 'string' && id.startsWith(prefix) && id.length > prefix.length;
}
