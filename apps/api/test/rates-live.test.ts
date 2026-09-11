import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_SOURCES, refreshRates, toDecimalString } from '../src/services/rates';
import { api, createTestContext, testConfig, type TestContext } from './helpers';

/** RATES_PROVIDER=live を偽の fetch で検証（外部には接続しない） */
describe('live レートプロバイダ', () => {
  let ctx: TestContext;
  beforeAll(() => {
    ctx = createTestContext();
  });
  afterAll(async () => {
    await api(ctx, 'POST', '/mock/rates/refresh');
    await ctx.close();
  });

  const fakeFetch = (overrides: Record<string, () => Response> = {}): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [k, fn] of Object.entries(overrides)) {
        if (url.includes(k)) return fn();
      }
      if (url.startsWith('https://api.frankfurter.app/latest?from=USD')) return Response.json({ base: 'USD', rates: { JPY: 151.23 } });
      if (url.startsWith('https://api.frankfurter.app/latest?from=EUR')) return Response.json({ base: 'EUR', rates: { JPY: 163.5 } });
      if (url.startsWith('https://api.frankfurter.app/latest?from=GBP')) return Response.json({ base: 'GBP', rates: { JPY: 191.75 } });
      if (url.startsWith(LIVE_SOURCES.coingecko)) return Response.json({ bitcoin: { jpy: 15500000 }, ethereum: { jpy: 480000.5 } });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

  it('Frankfurter + CoinGecko の値を rates に保存する', async () => {
    const r = await refreshRates(ctx.db, testConfig({ ratesProvider: 'live' }), fakeFetch());
    expect(r.provider).toBe('live');
    expect(r.errors).toEqual([]);
    expect(r.updated).toHaveLength(5);
    expect((await api(ctx, 'GET', '/rates?base=USD&quote=JPY')).json.rate).toBe('151.23');
    expect((await api(ctx, 'GET', '/rates?base=ETH&quote=JPY')).json.rate).toBe('480000.5');
    expect((await api(ctx, 'GET', '/rates?base=USD&quote=JPY')).json.source).toBe('frankfurter');
  });

  it('取得失敗した通貨は前回値を維持し、エラーを記録する', async () => {
    const r = await refreshRates(
      ctx.db,
      testConfig({ ratesProvider: 'live' }),
      fakeFetch({
        'from=USD': () => new Response('boom', { status: 500 }),
        coingecko: () => {
          throw new Error('network down');
        },
      }),
    );
    expect(r.errors.length).toBe(2);
    expect(r.errors[0]).toContain('USD/JPY');
    // USD は前回値（151.23）のまま、EUR は更新される
    expect((await api(ctx, 'GET', '/rates?base=USD&quote=JPY')).json.rate).toBe('151.23');
    expect((await api(ctx, 'GET', '/rates?base=EUR&quote=JPY')).json.rate).toBe('163.5');
    expect((await api(ctx, 'GET', '/rates?base=BTC&quote=JPY')).json.rate).toBe('15500000');
  });

  it('toDecimalString は指数表記を出さない', () => {
    expect(toDecimalString(151.23)).toBe('151.23');
    expect(toDecimalString(15000000)).toBe('15000000');
    expect(toDecimalString(0.0000123)).toBe('0.0000123');
  });
});
