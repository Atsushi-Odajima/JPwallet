import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbError } from '../src/lib/errors';
import { createTestContext, createUser, ledgerVerify, type TestContext } from './helpers';

/** post_journal（台帳コア）の不変条件 */
describe('post_journal', () => {
  let ctx: TestContext;
  let userId: string;

  beforeAll(async () => {
    ctx = createTestContext();
    userId = (await createUser(ctx)).id;
  });
  afterAll(() => ctx.close());

  const lines = (amount: string, currency = 'JPY') => [
    { owner_type: 'user', owner_id: userId, currency, amount },
    { system_code: 'card_clearing', currency, amount: `-${amount}` },
  ];

  it('通貨ごとの合計が 0 なら起票され、残高が更新される', async () => {
    const id = await ctx.db.rpc<string>('post_journal', {
      p_type: 'topup_card',
      p_idempotency_key: `t-${crypto.randomUUID()}`,
      p_lines: lines('1000'),
      p_reference_type: 'test',
      p_reference_id: null,
      p_metadata: {},
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const me = await ctx.db.rpc<{ wallets: { currency: string; balance: string }[] }>('get_me', { p_user_id: userId });
    expect(me.wallets.find((w) => w.currency === 'JPY')?.balance).toBe('1000');
  });

  it('同じ冪等キーは二重起票せず既存の journal を返す', async () => {
    const key = `idem-${crypto.randomUUID()}`;
    const a = await ctx.db.rpc<string>('post_journal', { p_type: 'topup_card', p_idempotency_key: key, p_lines: lines('500') });
    const b = await ctx.db.rpc<string>('post_journal', { p_type: 'topup_card', p_idempotency_key: key, p_lines: lines('500') });
    expect(a).toBe(b);
    const me = await ctx.db.rpc<{ wallets: { currency: string; balance: string }[] }>('get_me', { p_user_id: userId });
    expect(me.wallets.find((w) => w.currency === 'JPY')?.balance).toBe('1500');
  });

  it('合計が 0 でない仕訳は拒否される', async () => {
    await expect(
      ctx.db.rpc('post_journal', {
        p_type: 'adjustment',
        p_idempotency_key: null,
        p_lines: [{ owner_type: 'user', owner_id: userId, currency: 'JPY', amount: '10' }],
      }),
    ).rejects.toMatchObject({ code: 'journal_unbalanced' });
  });

  it('ユーザー口座が負になる仕訳は insufficient_funds で拒否され、ロールバックされる', async () => {
    const before = await ctx.db.rpc<{ wallets: { currency: string; balance: string }[] }>('get_me', { p_user_id: userId });
    let err: unknown;
    try {
      await ctx.db.rpc('post_journal', {
        p_type: 'payment',
        p_idempotency_key: null,
        p_lines: [
          { owner_type: 'user', owner_id: userId, currency: 'JPY', amount: '-999999' },
          { system_code: 'fee_revenue', currency: 'JPY', amount: '999999' },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DbError);
    expect((err as DbError).code).toBe('insufficient_funds');
    const after = await ctx.db.rpc<{ wallets: { currency: string; balance: string }[] }>('get_me', { p_user_id: userId });
    expect(after.wallets.find((w) => w.currency === 'JPY')?.balance).toBe(before.wallets.find((w) => w.currency === 'JPY')?.balance);
  });

  it('小数・非数値の金額は拒否される', async () => {
    await expect(
      ctx.db.rpc('post_journal', { p_type: 'adjustment', p_idempotency_key: null, p_lines: lines('1.5') }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(
      ctx.db.rpc('post_journal', { p_type: 'adjustment', p_idempotency_key: null, p_lines: lines('abc') }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
  });

  it('未対応通貨は拒否される', async () => {
    await expect(
      ctx.db.rpc('post_journal', { p_type: 'adjustment', p_idempotency_key: null, p_lines: lines('1', 'XXX') }),
    ).rejects.toMatchObject({ code: 'invalid_currency' });
  });

  it('ETH の wei 級の大きな整数も扱える', async () => {
    const big = '123456789012345678901234567890';
    const id = await ctx.db.rpc<string>('post_journal', {
      p_type: 'adjustment',
      p_idempotency_key: null,
      p_lines: [
        { system_code: 'crypto_custody', currency: 'JPY', amount: big },
        { system_code: 'fx_pool', currency: 'JPY', amount: `-${big}` },
      ],
    });
    expect(id).toBeTruthy();
    const v = await ledgerVerify(ctx);
    expect(v.ok).toBe(true);
  });

  it('同時に同じキーで起票しても 1 件しか作られない', async () => {
    const key = `race-${crypto.randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.db.rpc<string>('post_journal', { p_type: 'topup_card', p_idempotency_key: key, p_lines: lines('7') }),
      ),
    );
    expect(new Set(results).size).toBe(1);
  });

  it('ledger_verify: 全仕訳合計 0・負残高なし・balance と集計が一致', async () => {
    const v = await ledgerVerify(ctx);
    expect(v.ok).toBe(true);
    expect(v.unbalanced_journals).toEqual([]);
    expect(v.negative_accounts).toEqual([]);
    expect(v.balance_mismatches).toEqual([]);
  });
});
