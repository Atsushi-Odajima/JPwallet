import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DbError } from '../lib/errors';
import type { Db, RpcParams } from './port';

/**
 * Supabase アダプタ（本番想定）。service role で PostgREST の RPC を呼ぶ。
 * PostgREST は plpgsql の raise exception を { code, message, details, hint } で返す。
 */
export class SupabaseDb implements Db {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-payccount-client': 'api' } },
    });
  }

  async rpc<T = unknown>(fn: string, params: RpcParams = {}): Promise<T> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      clean[k] = typeof v === 'bigint' ? v.toString() : v === undefined ? null : v;
    }
    const { data, error } = await this.client.rpc(fn, clean);
    if (error) {
      const code = error.code ?? '';
      if (code === 'P0001') {
        throw new DbError(error.message, error.details ?? error.message, error.hint || undefined, code);
      }
      throw new DbError(error.message || 'database_error', error.details ?? error.message ?? '', undefined, code || 'PGRST');
    }
    return data as T;
  }

  async close() {
    // PostgREST は HTTP なので閉じるものはない
  }
}
