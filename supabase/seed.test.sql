-- Deterministic fixtures for automated tests (also handy for `supabase db reset` locally).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'admin@test.local'),
  ('00000000-0000-4000-8000-000000000002', 'manager@test.local'),
  ('00000000-0000-4000-8000-000000000003', 'warehouse@test.local'),
  ('00000000-0000-4000-8000-000000000004', 'sales@test.local'),
  ('00000000-0000-4000-8000-00000000000a', 'buyer-a@test.local'),
  ('00000000-0000-4000-8000-00000000000b', 'buyer-b@test.local'),
  ('00000000-0000-4000-8000-0000000000ff', 'pending@test.local');

insert into public.customers (id, name, gstin, credit_limit) values
  ('10000000-0000-4000-8000-00000000000a', 'Jaipur Kirana Traders', '08ABCDE1234F1Z5', 100000),
  ('10000000-0000-4000-8000-00000000000b', 'Ajmer Wholesale Mart',  '08PQRSX5678K1Z2', 5000);

insert into public.profiles (id, full_name, role, customer_id) values
  ('00000000-0000-4000-8000-000000000001', 'Asha Admin',     'admin',     null),
  ('00000000-0000-4000-8000-000000000002', 'Manoj Manager',  'manager',   null),
  ('00000000-0000-4000-8000-000000000003', 'Wasim Warehouse','warehouse', null),
  ('00000000-0000-4000-8000-000000000004', 'Sunita Sales',   'sales',     null),
  ('00000000-0000-4000-8000-00000000000a', 'Buyer A',        'customer',  '10000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b', 'Buyer B',        'customer',  '10000000-0000-4000-8000-00000000000b');

insert into public.warehouses (id, code, name) values
  ('20000000-0000-4000-8000-000000000001', 'JAI-01', 'Jaipur Main'),
  ('20000000-0000-4000-8000-000000000002', 'AJM-01', 'Ajmer Depot'),
  ('20000000-0000-4000-8000-000000000003', 'OLD-01', 'Closed Depot');
update public.warehouses set active = false where code = 'OLD-01';

insert into public.products (id, sku, name, unit, unit_price, min_order_qty, pack_size, active) values
  ('30000000-0000-4000-8000-000000000001', 'RICE-25KG', 'Basmati Rice 25kg', 'bag', 1200, 5, 5, true),
  ('30000000-0000-4000-8000-000000000002', 'OIL-15L',   'Mustard Oil 15L',   'tin', 2100, 1, 1, true),
  ('30000000-0000-4000-8000-000000000003', 'OLD-SKU',   'Discontinued Item', 'pcs', 50,   1, 1, false),
  ('30000000-0000-4000-8000-000000000004', 'SUGAR-50KG','Sugar 50kg',        'bag', 1900, 1, 1, true);

insert into public.inventory (product_id, warehouse_id, on_hand) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 100),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 10),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 50);
