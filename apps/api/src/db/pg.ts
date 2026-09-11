import postgres, { type Sql } from 'postgres';
import { DbError } from '../lib/errors';
import type { Db, RpcParams } from './port';

/**
 * postgres.js アダプタ（ローカル Postgres / テスト用。Workers では nodejs_compat が必要）
 * RPC は `select fn(p_a := $1, p_b := $2)` の形で呼ぶ。PostgREST と同じ名前付き引数呼び出し。
 */
export class PgDb implements Db {
  private readonly sql: Sql;

  constructor(databaseUrl: string, opts: { max?: number } = {}) {
    this.sql = postgres(databaseUrl, {
      max: opts.max ?? 4,
      prepare: false,
      // numeric(40,0) は文字列のまま受け取る（number に落とさない）
      types: {
        bigint: postgres.BigInt,
      },
      transform: {
        undefined: null,
      },
      onnotice: () => {},
    });
  }

  async rpc<T = unknown>(fn: string, params: RpcParams = {}): Promise<T> {
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new Error(`invalid rpc name: ${fn}`);
    const keys = Object.keys(params);
    for (const k of keys) {
      if (!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error(`invalid rpc param name: ${k}`);
    }
    const values = keys.map((k) => serialize(params[k]));
    const argList = keys.map((k, i) => `${k} := $${i + 1}${castFor(params[k])}`).join(', ');
    const query = `select ${fn}(${argList}) as result`;
    try {
      const rows = await this.sql.unsafe<{ result: unknown }[]>(query, values as never[]);
      return (rows[0]?.result ?? null) as T;
    } catch (e) {
      throw normalizePgError(e);
    }
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }

  /** テスト補助: 任意 SQL（アプリコードからは使わない） */
  get raw(): Sql {
    return this.sql;
  }
}

/**
 * 引数の変換ルール（RPC の宣言型に合わせる）
 *   - オブジェクト / オブジェクトを含む配列 → jsonb
 *   - プリミティブだけの配列            → text[]（RPC 側は text[] で受けて必要なら cast する）
 *   - bigint                            → 文字列（numeric）
 */
function isPrimitiveArray(v: unknown[]): boolean {
  return v.every((x) => x === null || x === undefined || ['string', 'number', 'boolean'].includes(typeof x));
}

function serialize(v: unknown): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) {
    if (isPrimitiveArray(v)) return v.map((x) => (x === null || x === undefined ? null : String(x)));
    // ::jsonb にキャストされるので postgres.js 側で JSON 化される（ここで stringify すると二重エンコードになる）
    return v;
  }
  if (typeof v === 'object') return v;
  return v;
}

function castFor(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return isPrimitiveArray(v) ? '::text[]' : '::jsonb';
  if (typeof v === 'object') return '::jsonb';
  return '';
}

function normalizePgError(e: unknown): Error {
  if (e && typeof e === 'object' && 'code' in e) {
    const pe = e as { code?: string; message?: string; detail?: string; hint?: string };
    const sqlState = pe.code ?? '';
    if (sqlState === 'P0001') {
      return new DbError(pe.message ?? 'error', pe.detail ?? pe.message ?? '', pe.hint || undefined, sqlState);
    }
    if (sqlState) {
      return new DbError(pe.message ?? 'database_error', pe.detail ?? pe.message ?? '', undefined, sqlState);
    }
  }
  return e instanceof Error ? e : new Error(String(e));
}
