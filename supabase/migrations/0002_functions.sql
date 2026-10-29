-- Stage 2: business logic as transactional Postgres functions (called via supabase.rpc).
-- All stock changes happen ONLY here, inside one transaction, with row locks.
-- Error contract: errcode 'P0001', MESSAGE = stable machine code, DETAIL = JSON context.
-- The Next.js layer maps codes to user-facing messages (src/lib/errors.ts).

-- Role of the calling user, or NULL if unauthenticated / deactivated.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create function public.current_customer_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.customer_id from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create function public.has_role(variadic roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = any(roles), false)
$$;

create function public.fail(code text, detail jsonb default '{}'::jsonb) returns void
language plpgsql as $$
begin
  raise exception '%', code using errcode = 'P0001', detail = detail::text;
end $$;

------------------------------------------------------------------------------
-- place_order: validate + reserve stock atomically. Idempotent per user+key.
-- p_items: [{"product_id": uuid, "warehouse_id": uuid, "quantity": int}, ...]
------------------------------------------------------------------------------
create function public.place_order(
  p_customer_id     uuid,
  p_items           jsonb,
  p_idempotency_key uuid,
  p_notes           text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid       uuid := auth.uid();
  v_role      public.app_role := public.current_app_role();
  v_order_id  uuid;
  v_total     numeric(14,2) := 0;
  v_line      record;
  v_count     int;
begin
  if v_uid is null or v_role is null then
    perform public.fail('UNAUTHENTICATED');
  end if;
  if v_role not in ('customer', 'sales', 'manager', 'admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'place_order'));
  end if;
  if v_role = 'customer' and p_customer_id is distinct from public.current_customer_id() then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'order_for_other_customer'));
  end if;
  if p_idempotency_key is null then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'idempotency_key'));
  end if;

  -- Idempotent replay: same user + key returns the original order.
  select id into v_order_id from public.orders
   where created_by = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return v_order_id;
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id and active) then
    perform public.fail('CUSTOMER_INACTIVE');
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'items'));
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count = 0 or v_count > 100 then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'items', 'count', v_count));
  end if;

  -- Normalise lines (merge duplicates), then lock inventory rows in a fixed
  -- order (product_id, warehouse_id) so concurrent orders cannot deadlock.
  drop table if exists pg_temp._lines;
  create temp table pg_temp._lines on commit drop as
  select (e->>'product_id')::uuid   as product_id,
         (e->>'warehouse_id')::uuid as warehouse_id,
         sum((e->>'quantity')::int)  as quantity
    from jsonb_array_elements(p_items) e
   group by 1, 2;

  if exists (select 1 from pg_temp._lines where product_id is null or warehouse_id is null
                                     or quantity is null or quantity <= 0) then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'items.quantity'));
  end if;

  if exists (select 1 from pg_temp._lines l
              where not exists (select 1 from public.products p where p.id = l.product_id)) then
    perform public.fail('PRODUCT_NOT_FOUND');
  end if;
  if exists (select 1 from pg_temp._lines l
              where not exists (select 1 from public.inventory i
                                 where i.product_id = l.product_id and i.warehouse_id = l.warehouse_id)) then
    perform public.fail('INSUFFICIENT_STOCK', jsonb_build_object('available', 0));
  end if;

  for v_line in
    select l.product_id, l.warehouse_id, l.quantity,
           p.sku, p.active as product_active, p.unit_price, p.min_order_qty, p.pack_size,
           i.on_hand, i.reserved
      from pg_temp._lines l
      join public.products p on p.id = l.product_id
      join public.inventory i
             on i.product_id = l.product_id and i.warehouse_id = l.warehouse_id
     order by l.product_id, l.warehouse_id
       for update of i
  loop
    if not v_line.product_active then
      perform public.fail('PRODUCT_INACTIVE', jsonb_build_object('sku', v_line.sku));
    end if;
    if v_line.quantity < v_line.min_order_qty then
      perform public.fail('BELOW_MIN_ORDER_QTY', jsonb_build_object(
        'sku', v_line.sku, 'min', v_line.min_order_qty, 'requested', v_line.quantity));
    end if;
    if v_line.quantity % v_line.pack_size <> 0 then
      perform public.fail('NOT_PACK_MULTIPLE', jsonb_build_object(
        'sku', v_line.sku, 'pack_size', v_line.pack_size, 'requested', v_line.quantity));
    end if;
    if coalesce(v_line.on_hand, 0) - coalesce(v_line.reserved, 0) < v_line.quantity then
      perform public.fail('INSUFFICIENT_STOCK', jsonb_build_object(
        'sku', v_line.sku,
        'available', greatest(coalesce(v_line.on_hand, 0) - coalesce(v_line.reserved, 0), 0),
        'requested', v_line.quantity));
    end if;
    v_total := v_total + v_line.quantity * v_line.unit_price;
  end loop;

  begin
    insert into public.orders (customer_id, total, notes, idempotency_key, created_by)
    values (p_customer_id, v_total, nullif(trim(p_notes), ''), p_idempotency_key, v_uid)
    returning id into v_order_id;
  exception when unique_violation then
    -- A concurrent request with the same key won the race.
    select id into v_order_id from public.orders
     where created_by = v_uid and idempotency_key = p_idempotency_key;
    return v_order_id;
  end;

  -- Prices come from the products table, never from the client.
  insert into public.order_items (order_id, product_id, warehouse_id, quantity, unit_price)
  select v_order_id, l.product_id, l.warehouse_id, l.quantity, p.unit_price
    from pg_temp._lines l join public.products p on p.id = l.product_id;

  update public.inventory i
     set reserved = i.reserved + l.quantity, updated_at = now()
    from pg_temp._lines l
   where i.product_id = l.product_id and i.warehouse_id = l.warehouse_id;

  insert into public.stock_movements (product_id, warehouse_id, type, quantity, order_id, actor_id)
  select product_id, warehouse_id, 'reserve', quantity, v_order_id, v_uid from pg_temp._lines;

  insert into public.order_status_history (order_id, from_status, to_status, actor_id)
  values (v_order_id, null, 'submitted', v_uid);

  return v_order_id;
end $$;

------------------------------------------------------------------------------
-- Order state machine. Allowed transitions and the roles that may perform them.
------------------------------------------------------------------------------
create function public.transition_allowed(
  p_from public.order_status, p_to public.order_status, p_role public.app_role
) returns boolean
language sql immutable as $$
  select case
    when (p_from, p_to) = ('submitted'::public.order_status, 'approved'::public.order_status)
      then p_role in ('manager', 'admin')
    when (p_from, p_to) = ('submitted', 'cancelled')
      then p_role in ('customer', 'sales', 'manager', 'admin')
    when (p_from, p_to) = ('approved', 'picking')
      then p_role in ('warehouse', 'manager', 'admin')
    when (p_from, p_to) in (('approved', 'cancelled'), ('picking', 'cancelled'))
      then p_role in ('manager', 'admin')
    when (p_from, p_to) = ('picking', 'shipped')
      then p_role in ('warehouse', 'manager', 'admin')
    when (p_from, p_to) = ('shipped', 'delivered')
      then p_role in ('warehouse', 'manager', 'admin')
    else false
  end
$$;

create function public.transition_order(
  p_order_id uuid,
  p_to       public.order_status,
  p_note     text default null
) returns public.order_status
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.app_role := public.current_app_role();
  v_order public.orders%rowtype;
  v_cust  public.customers%rowtype;
begin
  if v_uid is null or v_role is null then
    perform public.fail('UNAUTHENTICATED');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found
     or (v_role = 'customer' and v_order.customer_id is distinct from public.current_customer_id()) then
    -- Same error for "missing" and "not yours": do not leak existence.
    perform public.fail('ORDER_NOT_FOUND');
  end if;

  if not public.transition_allowed(v_order.status, p_to, v_role) then
    if public.transition_allowed(v_order.status, p_to, 'admin') then
      perform public.fail('FORBIDDEN', jsonb_build_object('from', v_order.status, 'to', p_to));
    end if;
    perform public.fail('INVALID_TRANSITION', jsonb_build_object('from', v_order.status, 'to', p_to));
  end if;

  if p_to = 'approved' then
    select * into v_cust from public.customers where id = v_order.customer_id for update;
    if v_cust.outstanding + v_order.total > v_cust.credit_limit then
      perform public.fail('CREDIT_LIMIT_EXCEEDED', jsonb_build_object(
        'limit', v_cust.credit_limit, 'outstanding', v_cust.outstanding, 'order_total', v_order.total));
    end if;
    update public.customers set outstanding = outstanding + v_order.total where id = v_cust.id;

  elsif p_to = 'cancelled' then
    perform 1 from public.inventory i
      join public.order_items oi on oi.product_id = i.product_id and oi.warehouse_id = i.warehouse_id
     where oi.order_id = p_order_id
     order by i.product_id, i.warehouse_id
       for update of i;
    update public.inventory i set reserved = i.reserved - oi.quantity, updated_at = now()
      from public.order_items oi
     where oi.order_id = p_order_id
       and i.product_id = oi.product_id and i.warehouse_id = oi.warehouse_id;
    insert into public.stock_movements (product_id, warehouse_id, type, quantity, order_id, actor_id, reason)
    select product_id, warehouse_id, 'release', -quantity, p_order_id, v_uid, 'order cancelled'
      from public.order_items where order_id = p_order_id;
    if v_order.status in ('approved', 'picking') then
      update public.customers set outstanding = greatest(outstanding - v_order.total, 0)
       where id = v_order.customer_id;
    end if;

  elsif p_to = 'shipped' then
    perform 1 from public.inventory i
      join public.order_items oi on oi.product_id = i.product_id and oi.warehouse_id = i.warehouse_id
     where oi.order_id = p_order_id
     order by i.product_id, i.warehouse_id
       for update of i;
    update public.inventory i
       set on_hand = i.on_hand - oi.quantity, reserved = i.reserved - oi.quantity, updated_at = now()
      from public.order_items oi
     where oi.order_id = p_order_id
       and i.product_id = oi.product_id and i.warehouse_id = oi.warehouse_id;
    insert into public.stock_movements (product_id, warehouse_id, type, quantity, order_id, actor_id)
    select product_id, warehouse_id, 'ship', -quantity, p_order_id, v_uid
      from public.order_items where order_id = p_order_id;
  end if;

  update public.orders set status = p_to, updated_at = now() where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, actor_id, note)
  values (p_order_id, v_order.status, p_to, v_uid, nullif(trim(p_note), ''));
  return p_to;
end $$;

------------------------------------------------------------------------------
-- Stock receiving (goods in) and manual adjustments (count corrections).
------------------------------------------------------------------------------
create function public.receive_stock(
  p_product_id uuid, p_warehouse_id uuid, p_quantity int, p_reason text default null
) returns int
language plpgsql security definer set search_path = '' as $$
declare v_on_hand int;
begin
  if not public.has_role('warehouse', 'manager', 'admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'receive_stock'));
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'quantity'));
  end if;
  insert into public.inventory (product_id, warehouse_id, on_hand)
  values (p_product_id, p_warehouse_id, p_quantity)
  on conflict (product_id, warehouse_id)
  do update set on_hand = public.inventory.on_hand + excluded.on_hand, updated_at = now()
  returning on_hand into v_on_hand;
  insert into public.stock_movements (product_id, warehouse_id, type, quantity, actor_id, reason)
  values (p_product_id, p_warehouse_id, 'receive', p_quantity, auth.uid(), p_reason);
  return v_on_hand;
end $$;

create function public.adjust_stock(
  p_product_id uuid, p_warehouse_id uuid, p_delta int, p_reason text
) returns int
language plpgsql security definer set search_path = '' as $$
declare v_inv public.inventory%rowtype;
begin
  if not public.has_role('manager', 'admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'adjust_stock'));
  end if;
  if p_delta is null or p_delta = 0 then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'delta'));
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'reason'));
  end if;
  select * into v_inv from public.inventory
   where product_id = p_product_id and warehouse_id = p_warehouse_id for update;
  if not found then
    perform public.fail('INVENTORY_NOT_FOUND');
  end if;
  if v_inv.on_hand + p_delta < v_inv.reserved then
    perform public.fail('ADJUST_BELOW_RESERVED', jsonb_build_object(
      'on_hand', v_inv.on_hand, 'reserved', v_inv.reserved, 'delta', p_delta));
  end if;
  update public.inventory set on_hand = on_hand + p_delta, updated_at = now()
   where product_id = p_product_id and warehouse_id = p_warehouse_id;
  insert into public.stock_movements (product_id, warehouse_id, type, quantity, actor_id, reason)
  values (p_product_id, p_warehouse_id, 'adjust', p_delta, auth.uid(), trim(p_reason));
  return v_inv.on_hand + p_delta;
end $$;

------------------------------------------------------------------------------
-- Catalog for buyers: availability only, never raw on_hand/reserved.
------------------------------------------------------------------------------
create function public.catalog_availability()
returns table (product_id uuid, sku text, name text, unit text, unit_price numeric,
               min_order_qty int, pack_size int, warehouse_id uuid, available int)
language sql stable security definer set search_path = '' as $$
  select p.id, p.sku, p.name, p.unit, p.unit_price, p.min_order_qty, p.pack_size,
         i.warehouse_id, greatest(i.on_hand - i.reserved, 0)
    from public.products p
    join public.inventory i on i.product_id = p.id
    join public.warehouses w on w.id = i.warehouse_id and w.active
   where p.active and public.current_app_role() is not null
$$;

-- Admin-only role management (profiles have no UPDATE grant for clients).
create function public.set_user_role(
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
  update public.profiles
     set role = p_role, customer_id = case when p_role = 'customer' then p_customer_id end
   where id = p_user_id;
end $$;
