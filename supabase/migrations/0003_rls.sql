-- Stage 3: grants + Row Level Security.
-- Principle: clients may READ through RLS; every WRITE to stock/orders goes
-- through the security-definer functions in 0002 (which enforce roles themselves).

-- 1. Lock everything down, then grant back the minimum.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles, public.customers, public.warehouses, public.products,
                public.inventory, public.orders, public.order_items,
                public.stock_movements, public.order_status_history
  to authenticated;
-- Catalog maintenance by managers/admins is a plain table write, guarded by RLS.
grant insert, update on public.products, public.warehouses to authenticated;
-- customers.outstanding is maintained only by transition_order(); no client column grant.
grant insert (name, gstin, credit_limit), update (name, gstin, credit_limit, active)
  on public.customers to authenticated;

grant execute on function
  public.place_order(uuid, jsonb, uuid, text),
  public.transition_order(uuid, public.order_status, text),
  public.receive_stock(uuid, uuid, int, text),
  public.adjust_stock(uuid, uuid, int, text),
  public.catalog_availability(),
  public.set_user_role(uuid, public.app_role, uuid),
  public.current_app_role(),
  public.current_customer_id(),
  public.has_role(public.app_role[])
  to authenticated;

-- 2. Enable RLS everywhere (deny-by-default).
alter table public.profiles             enable row level security;
alter table public.customers            enable row level security;
alter table public.warehouses           enable row level security;
alter table public.products             enable row level security;
alter table public.inventory            enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.order_status_history enable row level security;

-- profiles: see yourself; admins see everyone. No client writes (use set_user_role).
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.has_role('admin')));

-- customers: buyers see their own account; staff see all; manager/admin edit.
create policy customers_select on public.customers for select to authenticated
  using (id = (select public.current_customer_id())
         or (select public.has_role('admin', 'manager', 'sales', 'warehouse')));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select public.has_role('admin', 'manager')));
create policy customers_update on public.customers for update to authenticated
  using ((select public.has_role('admin', 'manager')))
  with check ((select public.has_role('admin', 'manager')));

-- warehouses: readable by any active user; admin manages.
create policy warehouses_select on public.warehouses for select to authenticated
  using ((select public.current_app_role()) is not null);
create policy warehouses_write on public.warehouses for insert to authenticated
  with check ((select public.has_role('admin')));
create policy warehouses_update on public.warehouses for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

-- products: buyers see active products; staff see all; manager/admin edit.
create policy products_select on public.products for select to authenticated
  using ((active and (select public.current_app_role()) is not null)
         or (select public.has_role('admin', 'manager', 'sales', 'warehouse')));
create policy products_insert on public.products for insert to authenticated
  with check ((select public.has_role('admin', 'manager')));
create policy products_update on public.products for update to authenticated
  using ((select public.has_role('admin', 'manager')))
  with check ((select public.has_role('admin', 'manager')));

-- inventory: staff only. Buyers use catalog_availability() (no raw counts).
create policy inventory_select on public.inventory for select to authenticated
  using ((select public.has_role('admin', 'manager', 'sales', 'warehouse')));

-- orders / items / history: buyers see their account's orders; staff see all.
create policy orders_select on public.orders for select to authenticated
  using (customer_id = (select public.current_customer_id())
         or (select public.has_role('admin', 'manager', 'sales', 'warehouse')));
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));  -- inherits orders RLS
create policy order_history_select on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- stock ledger: managers, admins, warehouse staff.
create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select public.has_role('admin', 'manager', 'warehouse')));
