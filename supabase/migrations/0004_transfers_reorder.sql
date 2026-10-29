-- Stage 7a: inter-warehouse transfers, reorder levels, low-stock report.

alter type public.movement_type add value if not exists 'transfer';

------------------------------------------------------------------------------
-- transfer_stock: move available units between warehouses atomically.
-- Writes two ledger rows (−qty at source, +qty at destination).
------------------------------------------------------------------------------
create function public.transfer_stock(
  p_product_id uuid, p_from_warehouse uuid, p_to_warehouse uuid, p_quantity int, p_reason text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_src public.inventory%rowtype;
begin
  if not public.has_role('warehouse', 'manager', 'admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'transfer_stock'));
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1000000 then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'quantity'));
  end if;
  if p_from_warehouse is null or p_to_warehouse is null or p_from_warehouse = p_to_warehouse then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'to_warehouse'));
  end if;
  if not exists (select 1 from public.warehouses where id = p_to_warehouse and active) then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'to_warehouse'));
  end if;

  -- Make sure the destination row exists, then lock BOTH rows in a fixed order
  -- (same ordering rule as place_order) so concurrent transfers can't deadlock.
  insert into public.inventory (product_id, warehouse_id, on_hand)
  values (p_product_id, p_to_warehouse, 0)
  on conflict (product_id, warehouse_id) do nothing;

  perform 1 from public.inventory
   where product_id = p_product_id and warehouse_id in (p_from_warehouse, p_to_warehouse)
   order by product_id, warehouse_id
     for update;

  select * into v_src from public.inventory
   where product_id = p_product_id and warehouse_id = p_from_warehouse;
  if not found then
    perform public.fail('INVENTORY_NOT_FOUND');
  end if;
  -- Only free stock can move: reserved units belong to open orders at the source.
  if v_src.on_hand - v_src.reserved < p_quantity then
    perform public.fail('INSUFFICIENT_STOCK', jsonb_build_object(
      'available', v_src.on_hand - v_src.reserved, 'requested', p_quantity));
  end if;

  update public.inventory set on_hand = on_hand - p_quantity, updated_at = now()
   where product_id = p_product_id and warehouse_id = p_from_warehouse;
  update public.inventory set on_hand = on_hand + p_quantity, updated_at = now()
   where product_id = p_product_id and warehouse_id = p_to_warehouse;

  insert into public.stock_movements (product_id, warehouse_id, type, quantity, actor_id, reason) values
    (p_product_id, p_from_warehouse, 'transfer', -p_quantity, auth.uid(), nullif(trim(p_reason), '')),
    (p_product_id, p_to_warehouse,   'transfer',  p_quantity, auth.uid(), nullif(trim(p_reason), ''));
end $$;

------------------------------------------------------------------------------
-- Reorder level per product+warehouse (inventory has no client UPDATE grant).
------------------------------------------------------------------------------
create function public.set_reorder_level(
  p_product_id uuid, p_warehouse_id uuid, p_level int
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role('manager', 'admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'set_reorder_level'));
  end if;
  if p_level is null or p_level < 0 or p_level > 1000000 then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'reorder_level'));
  end if;
  update public.inventory set reorder_level = p_level, updated_at = now()
   where product_id = p_product_id and warehouse_id = p_warehouse_id;
  if not found then
    perform public.fail('INVENTORY_NOT_FOUND');
  end if;
end $$;

------------------------------------------------------------------------------
-- Low-stock report: active products whose AVAILABLE stock is at/below reorder level.
------------------------------------------------------------------------------
create function public.low_stock_report()
returns table (product_id uuid, sku text, name text, warehouse_id uuid, warehouse_code text,
               on_hand int, reserved int, available int, reorder_level int, shortfall int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_role('admin', 'manager', 'warehouse', 'sales') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'low_stock_report'));
  end if;
  return query
  select p.id, p.sku, p.name, w.id, w.code, i.on_hand, i.reserved,
         i.on_hand - i.reserved, i.reorder_level,
         i.reorder_level - (i.on_hand - i.reserved)
    from public.inventory i
    join public.products p on p.id = i.product_id and p.active
    join public.warehouses w on w.id = i.warehouse_id and w.active
   where i.reorder_level > 0 and i.on_hand - i.reserved <= i.reorder_level
   order by i.reorder_level - (i.on_hand - i.reserved) desc, p.sku;
end $$;

revoke execute on function
  public.transfer_stock(uuid, uuid, uuid, int, text),
  public.set_reorder_level(uuid, uuid, int),
  public.low_stock_report()
  from public, anon;
grant execute on function
  public.transfer_stock(uuid, uuid, uuid, int, text),
  public.set_reorder_level(uuid, uuid, int),
  public.low_stock_report()
  to authenticated;
