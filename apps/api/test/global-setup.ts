import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * テスト用 DB を作り直してマイグレーション・シードを適用する。
 * ローカル Postgres（pnpm db:start）が起動していることが前提。
 * DB 名は payccount_test（PAYCCOUNT_DB_NAME で上書き）。
 */
export default function setup() {
  const root = path.resolve(__dirname, '../../..');
  const dbName = process.env.PAYCCOUNT_DB_NAME || 'payccount_test';
  const port = process.env.PAYCCOUNT_PGPORT || '54329';
  execFileSync('bash', [path.join(root, 'scripts/db/local.sh'), 'reset'], {
    stdio: 'inherit',
    env: { ...process.env, PAYCCOUNT_DB_NAME: dbName, PAYCCOUNT_PGPORT: port },
  });
  process.env.TEST_DATABASE_URL = `postgres://payccount:payccount@127.0.0.1:${port}/${dbName}`;
}
