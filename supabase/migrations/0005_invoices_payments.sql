-- Stage 7c-1: invoices (auto-issued at shipping) and customer payments (FIFO allocation).
--
-- Money model:
--   customers.outstanding += order total at APPROVAL (credit exposure, see 0002)
--   invoice issued at SHIPPING for the order total, due after payment_terms_days
--   record_payment() settles open invoices oldest-first and reduces outstanding,
--   which frees credit for new approvals.

create type public.invoice_status as enum ('open', 'paid');
create type public.payment_method as enum ('cash', 'bank_transfer', 'upi', 'cheque');

alter table public.customers
  add column payment_terms_days integer not null default 30
    check (payment_terms_days between 0 and 365);

create sequence public.invoice_number_seq start 1000;

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null unique default 'INV-' || nextval('public.invoice_number_seq')::text,
  order_id        uuid not null unique references public.orders(id),
  customer_id     uuid not null references public.customers(id),
  amount          numeric(14,2) not null check (amount > 0),
  amount_paid     numeric(14,2) not null default 0 check (amount_paid >= 0),
  status          public.invoice_status not null default 'open',
  issued_at       timestamptz not null default now(),
  due_date        date not null,
  constraint paid_within_amount check (amount_paid <= amount),
  constraint status_matches_balance check ((status = 'paid') = (amount_paid = amount))
);
create index invoices_customer_open_idx on public.invoices (customer_id, due_date, issued_at)
  where status = 'open';

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id),
  amount           numeric(14,2) not null check (amount > 0),
  method           public.payment_method not null,
  reference        text check (reference is null or length(reference) <= 100),
  idempotency_key  uuid not null,
  recorded_by      uuid not null references auth.users(id),
  received_at      timestamptz not null default now(),
  unique (recorded_by, idempotency_key)
);
create index payments_customer_idx on public.payments (customer_id, received_at desc);

create table public.payment_allocations (
  payment_id  uuid not null references public.payments(id),
  invoice_id  uuid not null references public.invoices(id),
  amount      numeric(14,2) not null check (amount > 0),
  primary key (payment_id, invoice_id)
);

create trigger payments_immutable before update or delete on public.payments
  for each row execute function public.reject_mutation();
create trigger payment_allocations_immutable before update or delete on public.payment_allocations
  for each row execute function public.reject_mutation();

------------------------------------------------------------------------------
-- Issue the invoice when an order becomes 'shipped' (only path to 'shipped' is
-- transition_order, which already holds the order row lock).
------------------------------------------------------------------------------
create function public.issue_invoice_on_ship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.invoices (order_id, customer_id, amount, due_date)
  select new.id, new.customer_id, new.total,
         (now() at time zone 'Asia/Kolkata')::date + c.payment_terms_days
    from public.customers c where c.id = new.customer_id;
  return new;
end $$;

create trigger orders_issue_invoice
  after update of status on public.orders
  for each row when (new.status = 'shipped' and old.status is distinct from 'shipped')
  execute function public.issue_invoice_on_ship();

------------------------------------------------------------------------------
-- record_payment: settle open invoices oldest-first. Idempotent per user+key.
------------------------------------------------------------------------------
create function public.record_payment(
  p_customer_id     uuid,
  p_amount          numeric,
  p_method          public.payment_method,
  p_reference       text,
  p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := auth.uid();
  v_payment_id uuid;
  v_due        numeric(14,2);
  v_left       numeric(14,2);
  v_take       numeric(14,2);
  v_inv        record;
begin
  if not public.has_role('manager', 'admin') then
    perform public.fail('FORBIDDEN', jsonb_build_object('action', 'record_payment'));
  end if;
  if p_idempotency_key is null then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'idempotency_key'));
  end if;
  select id into v_payment_id from public.payments
   where recorded_by = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return v_payment_id;
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'amount'));
  end if;
  if p_method is null then
    perform public.fail('VALIDATION', jsonb_build_object('field', 'method'));
  end if;

  -- Lock order: customer row first, then its open invoices by id (concurrent
  -- payments for one customer serialize here).
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    perform public.fail('CUSTOMER_NOT_FOUND');
  end if;
  perform 1 from public.invoices
   where customer_id = p_customer_id and status = 'open'
   order by id for update;

  select coalesce(sum(amount - amount_paid), 0) into v_due
    from public.invoices where customer_id = p_customer_id and status = 'open';
  if p_amount > v_due then
    perform public.fail('PAYMENT_EXCEEDS_DUE', jsonb_build_object('due', v_due, 'amount', p_amount));
  end if;

  begin
    insert into public.payments (customer_id, amount, method, reference, idempotency_key, recorded_by)
    values (p_customer_id, p_amount, p_method, nullif(trim(p_reference), ''), p_idempotency_key, v_uid)
    returning id into v_payment_id;
  exception when unique_violation then
    select id into v_payment_id from public.payments
     where recorded_by = v_uid and idempotency_key = p_idempotency_key;
    return v_payment_id;
  end;

  v_left := p_amount;
  for v_inv in
    select id, amount - amount_paid as balance from public.invoices
     where customer_id = p_customer_id and status = 'open'
     order by due_date, issued_at, id
  loop
    exit when v_left = 0;
    v_take := least(v_left, v_inv.balance);
    insert into public.payment_allocations (payment_id, invoice_id, amount)
    values (v_payment_id, v_inv.id, v_take);
    update public.invoices
       set amount_paid = amount_paid + v_take,
           status = case when amount_paid + v_take = amount then 'paid'::public.invoice_status else 'open' end
     where id = v_inv.id;
    v_left := v_left - v_take;
  end loop;

  update public.customers set outstanding = greatest(outstanding - p_amount, 0)
   where id = p_customer_id;
  return v_payment_id;
end $$;

------------------------------------------------------------------------------
-- Grants + RLS (Supabase auto-grants new objects to API roles: revoke first).
------------------------------------------------------------------------------
revoke all on public.invoices, public.payments, public.payment_allocations from anon, authenticated;
revoke all on sequence public.invoice_number_seq from anon, authenticated;
revoke execute on function public.issue_invoice_on_ship() from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, numeric, public.payment_method, text, uuid)
  from public, anon;
grant execute on function public.record_payment(uuid, numeric, public.payment_method, text, uuid)
  to authenticated;
grant select on public.invoices, public.payments, public.payment_allocations to authenticated;
-- Managers set payment terms alongside the existing customer column grants (0003).
grant insert (payment_terms_days), update (payment_terms_days) on public.customers to authenticated;

alter table public.invoices            enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;

create policy invoices_select on public.invoices for select to authenticated
  using (customer_id = (select public.current_customer_id())
         or (select public.has_role('admin', 'manager', 'sales')));
create policy payments_select on public.payments for select to authenticated
  using (customer_id = (select public.current_customer_id())
         or (select public.has_role('admin', 'manager', 'sales')));
create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id));  -- inherits payments RLS
