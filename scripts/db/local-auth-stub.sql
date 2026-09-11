-- ローカル Postgres 専用: Supabase の auth スキーマ・ロールの最小スタブ。
-- 本番（Supabase）にはこのファイルを適用しない。
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- RLS ポリシーで参照する auth.uid()（ローカルでは常に null）
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- デモ認証（AUTH_MODE=demo）: メールアドレスだけでユーザーを作成/取得する
create or replace function demo_upsert_user(p_email text, p_display_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_email is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_email', detail = 'メールアドレスの形式が正しくありません', hint = 'email';
  end if;
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then
    insert into auth.users (email, raw_user_meta_data)
    values (lower(p_email), jsonb_strip_nulls(jsonb_build_object('display_name', p_display_name)))
    returning id into v_id;
  end if;
  return jsonb_build_object('user_id', v_id, 'email', lower(p_email));
end $$;
