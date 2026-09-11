import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminToken, api, createTestContext, createUser, fundUser, type TestContext } from './helpers';

describe('共通ヘッダー・エラー形式', () => {
  let ctx: TestContext;
  beforeAll(() => {
    ctx = createTestContext();
  });
  afterAll(() => ctx.close());

  it('全レスポンスに X-Demo-Mode: true と X-Request-Id が付く', async () => {
    const r = await api(ctx, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Demo-Mode')).toBe('true');
    expect(r.headers.get('X-Request-Id')).toMatch(/^req_/);
  });

  it('404 も同じエラー形式', async () => {
    const r = await api(ctx, 'GET', '/nope');
    expect(r.status).toBe(404);
    expect(r.json.error.type).toBe('not_found');
    expect(r.headers.get('X-Demo-Mode')).toBe('true');
  });

  it('未認証は 401 authentication_error', async () => {
    const r = await api(ctx, 'GET', '/me');
    expect(r.status).toBe(401);
    expect(r.json.error.type).toBe('authentication_error');
  });

  it('壊れた JWT は 401', async () => {
    const r = await api(ctx, 'GET', '/me', { token: 'abc.def.ghi' });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('invalid_token');
  });
});

describe('デモ認証', () => {
  let ctx: TestContext;
  beforeAll(() => {
    ctx = createTestContext();
  });
  afterAll(() => ctx.close());

  it('メールアドレスでログインできる', async () => {
    const r = await api(ctx, 'POST', '/auth/demo/login', { body: { email: 'login-test@example.com' } });
    expect(r.status).toBe(200);
    expect(r.json.access_token).toBeTruthy();
    const me = await api(ctx, 'GET', '/me', { token: r.json.access_token });
    expect(me.status).toBe(200);
    expect(me.json.profile.email).toBe('login-test@example.com');
    expect(me.json.profile.role).toBe('user');
  });

  it('不正なメールは 400', async () => {
    const r = await api(ctx, 'POST', '/auth/demo/login', { body: { email: 'nope' } });
    expect(r.status).toBe(400);
    expect(r.json.error.type).toBe('invalid_request_error');
  });

  it('管理者 kuro / atusi0130 でログインでき、role=admin', async () => {
    const r = await api(ctx, 'POST', '/auth/demo/admin-login', { body: { id: 'kuro', password: 'atusi0130' } });
    expect(r.status).toBe(200);
    const me = await api(ctx, 'GET', '/me', { token: r.json.access_token });
    expect(me.json.profile.role).toBe('admin');
  });

  it('管理者のパスワード違いは 401', async () => {
    const r = await api(ctx, 'POST', '/auth/demo/admin-login', { body: { id: 'kuro', password: 'wrong' } });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('invalid_credentials');
  });
});

describe('/me', () => {
  let ctx: TestContext;
  let user: { id: string; token: string };
  beforeAll(async () => {
    ctx = createTestContext();
    user = await createUser(ctx);
  });
  afterAll(() => ctx.close());

  it('プロフィールと残高（初期は 0）', async () => {
    const r = await api(ctx, 'GET', '/me', { token: user.token });
    expect(r.status).toBe(200);
    expect(r.json.profile.user_id).toBe(user.id);
    const jpy = r.json.wallets.find((w: { currency: string }) => w.currency === 'JPY');
    expect(jpy.balance).toBe('0');
    expect(r.json.total_jpy).toBe('0');
  });

  it('取引履歴（journal ベース）とページネーション', async () => {
    for (let i = 0; i < 3; i++) await fundUser(ctx, user.id, 'JPY', String(100 * (i + 1)));
    const r1 = await api(ctx, 'GET', '/me/transactions?limit=2', { token: user.token });
    expect(r1.status).toBe(200);
    expect(r1.json.data).toHaveLength(2);
    expect(r1.json.has_more).toBe(true);
    expect(r1.json.data[0].lines[0]).toEqual({ currency: 'JPY', amount: '300' });
    const r2 = await api(ctx, 'GET', `/me/transactions?limit=2&starting_after=${r1.json.data[1].id}`, { token: user.token });
    expect(r2.json.data).toHaveLength(1);
    expect(r2.json.has_more).toBe(false);
    expect(r2.json.data[0].lines[0].amount).toBe('100');
  });

  it('通貨フィルタが不正なら 400', async () => {
    const r = await api(ctx, 'GET', '/me/transactions?currency=XXX', { token: user.token });
    expect(r.status).toBe(400);
  });

  it('プロフィール更新', async () => {
    const r = await api(ctx, 'PATCH', '/me', { token: user.token, body: { display_name: '太郎' } });
    expect(r.status).toBe(200);
    expect(r.json.display_name).toBe('太郎');
  });

  it('管理者以外は /admin にアクセスできない', async () => {
    const r = await api(ctx, 'GET', '/admin/ledger/verify', { token: user.token });
    expect(r.status).toBe(403);
    const ok = await api(ctx, 'GET', '/admin/ledger/verify', { token: await adminToken() });
    expect(ok.status).toBe(200);
    expect(ok.json.ok).toBe(true);
  });
});
