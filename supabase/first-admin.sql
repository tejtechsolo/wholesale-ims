-- Make an existing Supabase Auth user the first ADMIN of a hosted project.
-- 1) Dashboard → Authentication → Users → "Add user" → "Create new user":
--    enter the email + a strong password and tick "Auto Confirm User".
-- 2) Put that email and the person's name below, then run this in the SQL Editor.
-- 3) Sign in at /login. Admins must set up two-factor (authenticator app) on first sign-in.
do $$
declare
  v_email text := 'you@example.com';   -- ← change
  v_name  text := 'Your Name';         -- ← change
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'No auth user with email %. Create it first (step 1).', v_email;
  end if;
  insert into public.profiles (id, full_name, role, customer_id, active)
  values (v_id, v_name, 'admin', null, true)
  on conflict (id) do update set role = 'admin', customer_id = null, active = true, full_name = excluded.full_name;
  raise notice 'OK: % is now an admin', v_email;
end $$;
