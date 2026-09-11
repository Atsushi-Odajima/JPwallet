/**
 * DB ポート。API 層は Postgres の RPC（plpgsql 関数）だけを呼ぶ。
 *   - 本番: Supabase（PostgREST 経由）
 *   - ローカル/テスト: postgres.js で直接接続
 * どちらの実装も、RPC が raise した業務エラーを DbError に正規化する。
 */
export type RpcParams = Record<string, unknown>;

export interface Db {
  /** 関数名と名前付き引数で RPC を呼び、戻り値（jsonb / scalar）を返す */
  rpc<T = unknown>(fn: string, params?: RpcParams): Promise<T>;
  /** 接続を閉じる（テスト用） */
  close(): Promise<void>;
}
