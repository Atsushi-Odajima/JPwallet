/**
 * pnpm ledger:verify — 台帳の整合性を検証する。
 *   - 全仕訳: 同一 journal・同一通貨の合計 = 0
 *   - user / merchant 口座の残高 >= 0
 *   - accounts.balance と ledger_lines の集計が一致
 * DATABASE_URL（省略時はローカル Postgres）に接続し、DB 側の ledger_verify() を呼ぶ。
 * 問題があれば終了コード 1。
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgres://payccount:payccount@127.0.0.1:54329/payccount';

interface VerifyResult {
  ok: boolean;
  journal_count: number;
  line_count: number;
  unbalanced_journals: { journal_id: string; currency: string; sum: string }[];
  negative_accounts: { account_id: string; owner_type: string; owner_id: string; currency: string; balance: string }[];
  balance_mismatches: { account_id: string; currency: string; balance: string; computed: string }[];
  system_balances: { system_code: string; currency: string; balance: string }[];
  checked_at: string;
}

async function main() {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ result: VerifyResult }[]>`select ledger_verify() as result`;
    const r = row!.result;
    console.log(`payCcount ledger verify @ ${r.checked_at}`);
    console.log(`  journals: ${r.journal_count}  lines: ${r.line_count}`);
    console.log(`  unbalanced journals : ${r.unbalanced_journals.length}`);
    console.log(`  negative user/merchant accounts: ${r.negative_accounts.length}`);
    console.log(`  balance mismatches  : ${r.balance_mismatches.length}`);
    console.log('  system balances:');
    for (const s of r.system_balances) {
      console.log(`    ${s.system_code.padEnd(16)} ${s.currency.padEnd(4)} ${s.balance}`);
    }
    if (!r.ok) {
      if (r.unbalanced_journals.length) console.log('\n  ✘ unbalanced:', JSON.stringify(r.unbalanced_journals, null, 2));
      if (r.negative_accounts.length) console.log('\n  ✘ negative:', JSON.stringify(r.negative_accounts, null, 2));
      if (r.balance_mismatches.length) console.log('\n  ✘ mismatches:', JSON.stringify(r.balance_mismatches, null, 2));
      console.log('\nRESULT: FAIL');
      process.exitCode = 1;
    } else {
      console.log('\nRESULT: OK — 全仕訳合計 0 / user・merchant 口座 >= 0 / balance と集計が一致');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('ledger:verify failed:', e instanceof Error ? e.message : e);
  process.exit(2);
});
