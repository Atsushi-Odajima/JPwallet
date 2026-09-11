import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * E2E のグローバルセットアップ:
 *   1. ローカル Postgres にマイグレーションを適用
 *   2. API（wrangler dev :8787）とウォレット（vite :5173）を起動
 *   3. API で加盟店（Globe Goods / USD）・APIキー・Webhook を作成し、shop-global の .dev.vars を書いてビルド・起動（:5175）
 *   4. 状態を e2e/.state.json に保存。戻り値の関数が teardown
 */
const ROOT = path.resolve(__dirname, '..');
export const API = 'http://127.0.0.1:8787';
export const WEB = 'http://localhost:5173';
export const SHOP_GLOBAL = 'http://localhost:5175';
export const STATE_FILE = path.join(__dirname, '.state.json');

export interface E2EState {
  merchantId: string;
  apiKey: string;
  webhookSecret: string;
  ownerToken: string;
}

const procs: ChildProcess[] = [];
function start(cmd: string, args: string[], cwd: string) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.stderr?.on('data', (d) => {
    const s = String(d);
    if (/ERROR/.test(s)) process.stdout.write(`[${path.basename(cwd)}] ${s}`);
  });
  procs.push(p);
}
async function waitFor(url: string, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}
const json = <T>(r: Response) => r.json() as Promise<T>;

export default async function globalSetup() {
  execSync('bash scripts/db/local.sh migrate', { cwd: ROOT, stdio: 'ignore' });

  start('pnpm', ['exec', 'wrangler', 'dev', '--port', '8787'], path.join(ROOT, 'apps/api'));
  start('pnpm', ['exec', 'vite', '--port', '5173', '--strictPort'], path.join(ROOT, 'apps/web'));
  await waitFor(`${API}/health`);
  await waitFor(`${WEB}/`);

  const owner = await fetch(`${API}/auth/demo/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-owner-${Date.now()}@example.com` }),
  }).then(json<{ access_token: string }>);
  const H = { authorization: `Bearer ${owner.access_token}`, 'content-type': 'application/json' };
  const merchant = await fetch(`${API}/me/merchants`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Globe Goods (E2E)', settlement_currency: 'USD', country: 'US' }) }).then(json<{ id: string }>);
  const key = await fetch(`${API}/me/merchants/${merchant.id}/api-keys`, { method: 'POST', headers: H }).then(json<{ key: string }>);
  const wh = await fetch(`${API}/me/merchants/${merchant.id}/webhook-endpoints`, { method: 'POST', headers: H, body: JSON.stringify({ url: `${SHOP_GLOBAL}/api/webhook` }) }).then(json<{ secret: string }>);

  const shopDir = path.join(ROOT, 'apps/shop-global');
  writeFileSync(path.join(shopDir, '.dev.vars'), `PAYCCOUNT_API_URL=${API}\nPAYCCOUNT_SECRET_KEY=${key.key}\nPAYCCOUNT_WEBHOOK_SECRET=${wh.secret}\nSHOP_URL=${SHOP_GLOBAL}\n`);
  execSync('pnpm exec vite build', { cwd: shopDir, stdio: 'ignore' });
  start('pnpm', ['exec', 'wrangler', 'pages', 'dev', 'dist', '--port', '5175', '--kv', 'ORDERS', '--compatibility-date=2025-06-01', '--compatibility-flags=nodejs_compat'], shopDir);
  await waitFor(`${SHOP_GLOBAL}/api/config`);

  const state: E2EState = { merchantId: merchant.id, apiKey: key.key, webhookSecret: wh.secret, ownerToken: owner.access_token };
  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  return async () => {
    for (const p of procs) {
      try {
        if (p.pid) process.kill(-p.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  };
}
