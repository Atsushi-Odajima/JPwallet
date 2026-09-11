import { WebhookSignatureError, verifyWebhookSignature, type WebhookEvent } from '@payccount/shared';

export { WebhookSignatureError, verifyWebhookSignature };

/**
 * 署名を検証してイベントを返す。検証に失敗すると WebhookSignatureError。
 *
 * ```ts
 * const event = await constructEvent(rawBody, req.headers.get('X-payCcount-Signature'), process.env.PAYCCOUNT_WEBHOOK_SECRET);
 * if (event.type === 'payment.succeeded') { ... }
 * ```
 * 注意: rawBody は改変前の生のリクエスト本文（文字列）を渡すこと。JSON.parse → stringify したものでは署名が一致しない。
 */
export async function constructEvent<T = unknown>(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
  toleranceSec = 300,
): Promise<WebhookEvent<T>> {
  await verifyWebhookSignature(rawBody, signatureHeader, secret, toleranceSec);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WebhookSignatureError('Webhook 本文が JSON ではありません');
  }
  const ev = parsed as Partial<WebhookEvent<T>>;
  if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string' || typeof ev.type !== 'string' || !ev.data) {
    throw new WebhookSignatureError('Webhook イベントの形式が正しくありません');
  }
  return ev as WebhookEvent<T>;
}
