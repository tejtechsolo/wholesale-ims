-- Stage 7c-2: user administration helpers for the admin console.
-- Accounts are created by scripts/invite-user.mjs (server-side, secret key). From the app,
-- admins can only change role / active flag / display name of OTHER users.

create function public.set_user_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'set_user_active'));
  end if;
  if p_user_id = auth.uid() then
    perform public.fail('FORBIDDEN', jsonb_build_object('reason', 'cannot deactivate yourself'));
  end if;
  if p_active is null then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'active'));
  end if;
  update public.profiles set active = p_active where id = p_user_id;
  if not found then
    perform public.fail('USER_NOT_FOUND');
  end if;
end $$;

-- set_user_role (0002) silently did nothing for an unknown user and could create an
-- invalid customer profile; make it strict. Same signature, so grants are kept.
create or replace function public.set_user_role(
  p_user_id uuid, p_role public.app_role, p_customer_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'set_user_role'));
  end if;
  if p_user_id = auth.uid() then
    perform public.fail('FORBIDDEN', jsonb_build_object('reason', 'cannot change own role'));
  end if;
  if p_role is null or (p_role = 'customer' and p_customer_id is null) then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'customer_id'));
  end if;
  if p_role = 'customer' and not exists (select 1 from public.customers where id = p_customer_id) then
    perform public.fail('CUSTOMER_NOT_FOUND');
  end if;
  update public.profiles
     set role = p_role, customer_id = case when p_role = 'customer' then p_customer_id end
   where id = p_user_id;
  if not found then
    perform public.fail('USER_NOT_FOUND');
  end if;
end $$;

-- Directory for the admin console: profile + login email (auth.users is not exposed to the API).
create function public.admin_list_users()
returns table (id uuid, email text, full_name text, role public.app_role,
               customer_id uuid, customer_name text, active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'admin_list_users'));
  end if;
  return query
  select p.id, u.email::text, p.full_name, p.role, p.customer_id, c.name, p.active, p.created_at
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.customers c on c.id = p.customer_id
   order by p.active desc, p.role, lower(p.full_name);
end $$;

revoke execute on function public.set_user_active(uuid, boolean), public.admin_list_users()
  from public, anon;
grant execute on function public.set_user_active(uuid, boolean), public.admin_list_users()
  to authenticated;
