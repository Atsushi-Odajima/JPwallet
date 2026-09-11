-- ============================================================================
-- 0008: Supabase 用のテーブル権限
--   Management API（SQL エディタ相当）で作成したテーブルには service_role への GRANT が付かないことがあり、
--   `security definer` でない関数（get_rate / get_rate_json / convert_* などの stable ヘルパー）を
--   PostgREST（service_role）から直接呼ぶと "permission denied for table rates" になる。
--   API は service_role でのみ接続するため、service_role に public スキーマの全テーブル・シーケンスを許可する。
--   anon / authenticated には付与しない（ブラウザは PostgREST を直接使わず、常に API 経由）。
--   ローカル Postgres（service_role ロールが無い）では何もしない。
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all privileges on all tables in schema public to service_role;
    grant all privileges on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;
    -- 以後このロールが作るオブジェクトにも同じ権限を付ける
    alter default privileges in schema public grant all privileges on tables to service_role;
    alter default privileges in schema public grant all privileges on sequences to service_role;
    alter default privileges in schema public grant execute on functions to service_role;
  end if;
end $$;
