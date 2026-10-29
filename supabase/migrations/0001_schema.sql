-- Stage 1: core schema for wholesale inventory management
-- Run order: 0001_schema -> 0002_functions -> 0003_rls

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'manager', 'warehouse', 'sales', 'customer');

create type public.order_status as enum (
  'submitted', 'approved', 'picking', 'shipped', 'delivered', 'cancelled'
);

create type public.movement_type as enum (
  'receive', 'adjust', 'reserve', 'release', 'ship'
);

-- B2B buyer accounts (a retailer / distributor)
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 200),
  gstin         text unique check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  credit_limit  numeric(14,2) not null default 0 check (credit_limit >= 0),
  outstanding   numeric(14,2) not null default 0 check (outstanding >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- One row per auth user. Role is NEVER taken from JWT user_metadata (user-editable).
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null default '',
  role         public.app_role not null default 'customer',
  customer_id  uuid references public.customers(id),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint customer_role_needs_account
    check ((role = 'customer') = (customer_id is not null))
);

create table public.warehouses (
  id     uuid primary key default gen_random_uuid(),
  code   text not null unique check (code ~ '^[A-Z0-9-]{2,20}$'),
  name   text not null,
  active boolean not null default true
);

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  sku            text not null unique check (sku ~ '^[A-Z0-9-]{3,40}$'),
  name           text not null check (length(trim(name)) between 2 and 200),
  unit           text not null default 'pcs',
  unit_price     numeric(12,2) not null check (unit_price > 0),
  min_order_qty  integer not null default 1 check (min_order_qty >= 1),
  pack_size      integer not null default 1 check (pack_size >= 1),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Stock per product per warehouse. available = on_hand - reserved.
create table public.inventory (
  product_id    uuid not null references public.products(id),
  warehouse_id  uuid not null references public.warehouses(id),
  on_hand       integer not null default 0 check (on_hand >= 0),
  reserved      integer not null default 0 check (reserved >= 0),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  updated_at    timestamptz not null default now(),
  primary key (product_id, warehouse_id),
  constraint reserved_within_on_hand check (reserved <= on_hand)
);

create sequence public.order_number_seq start 1000;

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text not null unique
                   default 'WO-' || nextval('public.order_number_seq')::text,
  customer_id      uuid not null references public.customers(id),
  status           public.order_status not null default 'submitted',
  total            numeric(14,2) not null check (total >= 0),
  notes            text check (notes is null or length(notes) <= 1000),
  idempotency_key  uuid not null,
  created_by       uuid not null references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (created_by, idempotency_key)
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_status_idx   on public.orders (status);

create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid not null references public.products(id),
  warehouse_id  uuid not null references public.warehouses(id),
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12,2) not null check (unit_price > 0),
  unique (order_id, product_id, warehouse_id)
);

-- Append-only stock ledger: every change to inventory is explained here.
create table public.stock_movements (
  id            bigint generated always as identity primary key,
  product_id    uuid not null references public.products(id),
  warehouse_id  uuid not null references public.warehouses(id),
  type          public.movement_type not null,
  quantity      integer not null check (quantity <> 0),
  order_id      uuid references public.orders(id),
  reason        text,
  actor_id      uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

create table public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  actor_id    uuid references auth.users(id),
  note        text,
  created_at  timestamptz not null default now()
);

-- Ledger and history are immutable, even for table owners via app paths.
create function public.reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'append-only table: % not allowed', tg_op using errcode = '42501';
end $$;

create trigger stock_movements_immutable before update or delete on public.stock_movements
  for each row execute function public.reject_mutation();
create trigger order_history_immutable before update or delete on public.order_status_history
  for each row execute function public.reject_mutation();
