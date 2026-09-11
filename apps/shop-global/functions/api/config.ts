import { json, type Env } from '../_lib/store';

/** GET /api/config — フロントに設定状態を返す（秘密は返さない） */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return json({
    configured: !!env.PAYCCOUNT_SECRET_KEY,
    webhook_configured: !!env.PAYCCOUNT_WEBHOOK_SECRET,
    api_url: env.PAYCCOUNT_API_URL ?? 'http://localhost:8787',
    storage: env.ORDERS ? 'kv' : 'memory',
  });
};
