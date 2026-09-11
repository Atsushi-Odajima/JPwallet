-- ============================================================================
-- payCcount seed
--   * 管理者アカウント（ID: kuro / パスワード: atusi0130）— デモ専用の固定値
--     - Supabase: auth.users + auth.identities に投入（メール kuro@payccount.demo でパスワードログイン可）
--     - ローカル : auth.users スタブに投入し、admin_credentials で ID/パスワード認証
-- ============================================================================

do $$
declare
  v_admin_id uuid := '00000000-0000-4000-8000-000000000001';
  v_email    text := 'kuro@payccount.demo';
  v_password text := 'atusi0130';
begin
  -- Supabase では pgcrypto（crypt / gen_salt）が extensions スキーマにあるため検索パスに加える（ローカルでは無視される）
  perform set_config('search_path', 'public, extensions', true);

  if to_regclass('auth.identities') is not null then
    -- Supabase（GoTrue）環境
    execute format($sql$
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change, is_sso_user
      ) values (
        '00000000-0000-0000-0000-000000000000', %L, 'authenticated', 'authenticated', %L,
        crypt(%L, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"kuro"}'::jsonb, now(), now(),
        '', '', '', '', false
      ) on conflict (id) do nothing
    $sql$, v_admin_id, v_email, v_password);

    execute format($sql$
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), %L, %L, 'email', jsonb_build_object('sub', %L, 'email', %L, 'email_verified', true), now(), now(), now())
      on conflict do nothing
    $sql$, v_admin_id, v_admin_id::text, v_admin_id::text, v_email);
  else
    -- ローカルスタブ
    execute format($sql$
      insert into auth.users (id, email, raw_user_meta_data)
      values (%L, %L, '{"display_name":"kuro"}'::jsonb)
      on conflict (id) do nothing
    $sql$, v_admin_id, v_email);
  end if;

  insert into profiles (user_id, email, display_name, role)
  values (v_admin_id, v_email, 'kuro（管理者）', 'admin')
  on conflict (user_id) do update set role = 'admin', display_name = 'kuro（管理者）';

  insert into admin_credentials (login_id, user_id, password_hash)
  values ('kuro', v_admin_id, crypt(v_password, gen_salt('bf')))
  on conflict (login_id) do update set password_hash = excluded.password_hash, user_id = excluded.user_id;
end $$;
