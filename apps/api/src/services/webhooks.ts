import { SIGNATURE_HEADER, signWebhookPayload, type WebhookDelivery } from '@payccount/shared';
import type { Db } from '../db/port';

interface ClaimedDelivery {
  delivery_id: string;
  event_id: string;
  endpoint_id: string;
  attempts: number;
  url: string;
  secret: string;
  event: Record<string, unknown>;
}

export interface DeliveryRunResult {
  claimed: number;
  delivered: number;
  failed: number;
  results: { delivery_id: string; status: string; status_code: number | null; error: string | null }[];
}

const TIMEOUT_MS = 10_000;

/**
 * 期限が来た Webhook 配信を取り出して送信する。
 *   - 署名: X-payCcount-Signature: t=<unix>,v1=<hex(HMAC-SHA256(secret, t + "." + body))>
 *   - 失敗時は record_webhook_delivery が指数バックオフ（1分, 5分, 30分, 2時間, 12時間）で再スケジュール
 *   - レスポンスコードと本文の先頭 1KB を保存
 * 決済直後（waitUntil）と Cron（毎分）の両方から呼ばれる。多重実行は skip locked で安全。
 */
export async function deliverDueWebhooks(db: Db, fetcher: typeof fetch, limit = 20): Promise<DeliveryRunResult> {
  const claimed = (await db.rpc<ClaimedDelivery[]>('claim_webhook_deliveries', { p_limit: limit })) ?? [];
  const result: DeliveryRunResult = { claimed: claimed.length, delivered: 0, failed: 0, results: [] };

  await Promise.all(
    claimed.map(async (d) => {
      const body = JSON.stringify(d.event);
      const signature = await signWebhookPayload(body, d.secret);
      let statusCode: number | null = null;
      let responseBody = '';
      let error: string | null = null;
      let success = false;
      try {
        const res = await fetcher(d.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'payCcount-Webhooks/1.0 (demo)',
            [SIGNATURE_HEADER]: signature,
            'X-payCcount-Event-Id': d.event_id,
            'X-payCcount-Delivery-Id': d.delivery_id,
            'X-payCcount-Attempt': String(d.attempts + 1),
            'X-Demo-Mode': 'true',
          },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: 'manual',
        });
        statusCode = res.status;
        responseBody = (await res.text().catch(() => '')).slice(0, 1024);
        success = res.status >= 200 && res.status < 300;
        if (!success) error = `HTTP ${res.status}`;
      } catch (e) {
        error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      }
      const rec = await db.rpc<WebhookDelivery>('record_webhook_delivery', {
        p_delivery_id: d.delivery_id,
        p_success: success,
        p_status_code: statusCode,
        p_response_body: responseBody,
        p_error: error,
      });
      if (success) result.delivered++;
      else result.failed++;
      result.results.push({ delivery_id: d.delivery_id, status: rec.status, status_code: statusCode, error });
    }),
  );
  return result;
}
