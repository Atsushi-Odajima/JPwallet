import { defineConfig } from '@playwright/test';

/**
 * E2E: チャージ → 両替 → 海外EC（shop-global）で BTC 払い → 返金
 * サーバー（API / ウォレット / shop-global）は global-setup.ts が起動する。
 * 前提: pnpm db:start でローカル Postgres が動いていること。
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1100, height: 900 },
    locale: 'ja-JP',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
});
