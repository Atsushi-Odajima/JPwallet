-- ローカル Postgres 専用のデモデータ（Supabase には適用しない）
-- デモユーザー: demo@example.com（AUTH_MODE=demo ではメールアドレスだけでログインできる）
do $$
declare
  v_user_id uuid := '00000000-0000-4000-8000-000000000002';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_user_id, 'demo@example.com', '{"display_name":"デモユーザー"}'::jsonb)
  on conflict (id) do nothing;
  insert into profiles (user_id, email, display_name)
  values (v_user_id, 'demo@example.com', 'デモユーザー')
  on conflict (user_id) do nothing;
end $$;
