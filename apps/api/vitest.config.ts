import { defineConfig } from 'vitest/config';

// テストはローカル Postgres（pnpm db:start）に対して直列に実行する。
// 接続先は TEST_DATABASE_URL または DATABASE_URL、未設定なら scripts/db/local.sh のデフォルト。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
