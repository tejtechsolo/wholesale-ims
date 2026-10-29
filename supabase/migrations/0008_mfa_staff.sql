-- Stage 7c-3b: admins and managers must have completed MFA (JWT aal = 'aal2').
--
-- Every permission check goes through current_app_role() (has_role(), RLS policies,
-- all business functions), so redefining it enforces MFA everywhere at once: an admin or
-- manager with a password-only (aal1) session simply has no role in the database.
-- The app sends them to /account/mfa to enrol or verify; that page talks to Supabase Auth
-- directly and reads only their own profile (allowed by profiles_select: id = auth.uid()).
-- Other roles are unaffected (MFA optional for them).

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select case
           when p.role in ('admin', 'manager')
                and coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then null
           else p.role
         end
    from public.profiles p
   where p.id = auth.uid() and p.active
$$;
