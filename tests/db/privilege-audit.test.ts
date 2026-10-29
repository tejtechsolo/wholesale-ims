// Snapshot of EVERY privilege the API roles hold in `public`.
// Supabase grants new tables/functions to anon/authenticated by default (emulated in
// auth-shim.sql), so a migration that forgets to revoke shows up here as a diff.
// Changing this list is a security review decision: say why in the PR.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

const EXPECTED = [
  "COL authenticated customers INSERT (credit_limit,gstin,name,payment_terms_days)",
  "COL authenticated customers UPDATE (active,credit_limit,gstin,name,payment_terms_days)",
  "FUNC authenticated adjust_stock",
  "FUNC authenticated admin_list_users",
  "FUNC authenticated catalog_availability",
  "FUNC authenticated current_app_role",
  "FUNC authenticated current_customer_id",
  "FUNC authenticated has_role",
  "FUNC authenticated low_stock_report",
  "FUNC authenticated place_order",
  "FUNC authenticated receive_stock",
  "FUNC authenticated record_payment",
  "FUNC authenticated set_reorder_level",
  "FUNC authenticated set_user_active",
  "FUNC authenticated set_user_role",
  "FUNC authenticated transfer_stock",
  "FUNC authenticated transition_order",
  "TABLE authenticated customers SELECT",
  "TABLE authenticated inventory SELECT",
  "TABLE authenticated invoices SELECT",
  "TABLE authenticated order_items SELECT",
  "TABLE authenticated order_status_history SELECT",
  "TABLE authenticated orders SELECT",
  "TABLE authenticated payment_allocations SELECT",
  "TABLE authenticated payments SELECT",
  "TABLE authenticated products INSERT,SELECT,UPDATE",
  "TABLE authenticated profiles SELECT",
  "TABLE authenticated stock_movements SELECT",
  "TABLE authenticated warehouses INSERT,SELECT,UPDATE",
];

const AUDIT = `
  select 'TABLE ' || grantee || ' ' || table_name || ' ' || string_agg(privilege_type, ',' order by privilege_type) as g
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
   group by grantee, table_name
  union all
  select 'COL ' || grantee || ' ' || table_name || ' ' || privilege_type
         || ' (' || string_agg(column_name, ',' order by column_name) || ')'
    from information_schema.column_privileges cp
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and not exists (select 1 from information_schema.role_table_grants t
                      where t.table_schema = 'public' and t.grantee = cp.grantee
                        and t.table_name = cp.table_name and t.privilege_type = cp.privilege_type)
   group by grantee, table_name, privilege_type
  union all
  select 'FUNC ' || r.rolname || ' ' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
   where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'execute')
  union all
  select 'SEQ ' || r.rolname || ' ' || c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
   where n.nspname = 'public' and c.relkind = 'S'
     and has_sequence_privilege(r.rolname, c.oid, 'usage,select,update')
  order by 1`;

describe("privilege audit", () => {
  it("API roles hold exactly the reviewed privileges (anon: none)", async () => {
    const actual = (await db.pool.query(AUDIT)).rows.map((r) => r.g);
    expect(actual).toEqual(EXPECTED);
  });

  it("every table in public has RLS enabled", async () => {
    const r = await db.pool.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`);
    expect(r.rows).toEqual([]);
  });

  it("every SECURITY DEFINER function pins search_path", async () => {
    const r = await db.pool.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
       order by 1`);
    expect(r.rows).toEqual([]);
  });
});
