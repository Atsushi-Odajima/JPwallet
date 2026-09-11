import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, api, createTestContext, createUser, fundUser, type TestContext } from './helpers';

describe('管理API（管理者 kuro）', () => {
  let ctx: TestContext;
  let admin: string;
  let user: { id: string; token: string; email: string };
  beforeAll(async () => {
    ctx = createTestContext();
    admin = await adminToken();
    user = await createUser(ctx, 'admin-target@example.com');
    await fundUser(ctx, user.id, 'JPY', '1234');
  });
  afterAll(() => ctx.close());

  it('一般ユーザーは 403', async () => {
    expect((await api(ctx, 'GET', '/admin/overview', { token: user.token })).status).toBe(403);
    expect((await api(ctx, 'GET', '/admin/users', { token: user.token })).status).toBe(403);
  });

  it('概要: 件数・システム勘定・台帳検証', async () => {
    const r = await api(ctx, 'GET', '/admin/overview', { token: admin });
    expect(r.status).toBe(200);
    expect(r.json.counts.users).toBeGreaterThanOrEqual(2);
    expect(r.json.ledger.ok).toBe(true);
    expect(Array.isArray(r.json.system_balances)).toBe(true);
    expect(Array.isArray(r.json.recent_journals)).toBe(true);
  });

  it('ユーザー一覧（検索・残高）と詳細', async () => {
    const list = await api(ctx, 'GET', '/admin/users?q=admin-target', { token: admin });
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].balances.JPY).toBe('1234');
    expect(list.json.data[0].total_jpy).toBe('1234');
    const detail = await api(ctx, 'GET', `/admin/users/${user.id}`, { token: admin });
    expect(detail.status).toBe(200);
    expect(detail.json.me.profile.email).toBe(user.email);
    expect(detail.json.transactions.length).toBeGreaterThanOrEqual(1);
    expect((await api(ctx, 'GET', '/admin/users/not-a-uuid', { token: admin })).status).toBe(400);
  });

  it('仕訳ブラウザに口座の持ち主が付く', async () => {
    const r = await api(ctx, 'GET', '/admin/journals?limit=5', { token: admin });
    expect(r.status).toBe(200);
    const j = r.json.data.find((x: { lines: { owner: string }[] }) => x.lines.some((l) => l.owner === 'admin-target'));
    expect(j).toBeTruthy();
    expect(j.lines.find((l: { owner_type: string }) => l.owner_type === 'system').owner).toMatch(/^system:/);
    const typed = await api(ctx, 'GET', '/admin/journals?type=adjustment&limit=2', { token: admin });
    expect(typed.json.data.every((x: { type: string }) => x.type === 'adjustment')).toBe(true);
  });

  it('口座・決済・Session・Webhook・監査ログ・キャンペーンの一覧', async () => {
    for (const path of ['/admin/accounts', '/admin/payments', '/admin/checkout-sessions', '/admin/webhooks/deliveries', '/admin/audit-logs', '/admin/point-campaigns', '/admin/merchants']) {
      const r = await api(ctx, 'GET', path, { token: admin });
      expect(r.status, path).toBe(200);
      expect(Array.isArray(r.json.data), path).toBe(true);
    }
    const failed = await api(ctx, 'GET', '/admin/webhooks/deliveries?status=failed', { token: admin });
    expect(failed.json.data.every((d: { status: string }) => d.status === 'failed')).toBe(true);
  });

  it('保守処理を手動実行できる', async () => {
    const r = await api(ctx, 'POST', '/admin/maintenance/run', { token: admin });
    expect(r.status).toBe(200);
    expect(r.json.webhooks).toBeTruthy();
    expect(typeof r.json.expired_checkout_sessions).toBe('number');
  });
});
