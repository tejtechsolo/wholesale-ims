-- Minimal emulation of the Supabase auth schema for local DB tests.
-- In real Supabase these already exist; this file is NOT a migration.
-- Roles are cluster-wide. tests/helpers/global-setup.ts creates them once before the
-- parallel test files start; the exception handler keeps this safe if run concurrently.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    begin
      execute format('create role %I nologin', r);
    exception when duplicate_object or unique_violation then null;
    end;
  end loop;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
