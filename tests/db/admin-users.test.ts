import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { C, P, U, WH, createTestDb, expectDbError, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe("admin_list_users", () => {
  it("returns profiles with login email for admins only", async () => {
    const rows = await db.as(U.admin, "select email, role, customer_name from public.admin_list_users()");
    expect(rows).toContainEqual({ email: "buyer-a@test.local", role: "customer", customer_name: "Jaipur Kirana Traders" });
    expect(rows.length).toBe(6); // the pending user has no profile
    for (const u of [U.manager, U.sales, U.warehouse, U.buyerA])
      await expectDbError(db.as(u, "select * from public.admin_list_users()"), "FORBIDDEN");
  });
});

describe("set_user_active", () => {
  it("admin can deactivate and reactivate another user; access follows immediately", async () => {
    await db.as(U.admin, "select public.set_user_active($1, false)", [U.warehouse]);
    await expectDbError(db.as(U.warehouse, "select public.receive_stock($1, $2, 1)", [P.oil, WH]), "FORBIDDEN");
    await db.as(U.admin, "select public.set_user_active($1, true)", [U.warehouse]);
    await expect(db.as(U.warehouse, "select public.receive_stock($1, $2, 1)", [P.oil, WH])).resolves.toBeTruthy();
  });

  it("refuses self-deactivation, non-admins and unknown users", async () => {
    await expectDbError(db.as(U.admin, "select public.set_user_active($1, false)", [U.admin]), "FORBIDDEN");
    await expectDbError(db.as(U.manager, "select public.set_user_active($1, false)", [U.sales]), "FORBIDDEN");
    await expectDbError(db.as(U.admin, "select public.set_user_active($1, false)", [randomUUID()]), "USER_NOT_FOUND");
  });
});

describe("set_user_role (hardened)", () => {
  it("requires an existing customer account for the customer role", async () => {
    await expectDbError(db.as(U.admin, "select public.set_user_role($1, 'customer')", [U.sales]), "VALIDATION");
    await expectDbError(db.as(U.admin, "select public.set_user_role($1, 'customer', $2)", [U.sales, randomUUID()]),
      "CUSTOMER_NOT_FOUND");
    await db.as(U.admin, "select public.set_user_role($1, 'customer', $2)", [U.sales, C.B]);
    expect(await db.one("select role, customer_id from public.profiles where id = $1", [U.sales]))
      .toEqual({ role: "customer", customer_id: C.B });
    await db.as(U.admin, "select public.set_user_role($1, 'sales')", [U.sales]);
    expect(await db.one("select role, customer_id from public.profiles where id = $1", [U.sales]))
      .toEqual({ role: "sales", customer_id: null });
  });

  it("reports unknown users instead of silently doing nothing", async () => {
    await expectDbError(db.as(U.admin, "select public.set_user_role($1, 'manager')", [randomUUID()]), "USER_NOT_FOUND");
  });
});

describe("catalog and customer maintenance through RLS", () => {
  it("manager creates and edits products; DB constraints reject bad data", async () => {
    const [p] = await db.as(U.manager,
      "insert into public.products (sku, name, unit, unit_price, min_order_qty, pack_size) values ('DAL-30KG', 'Toor Dal 30kg', 'bag', 3600, 2, 2) returning id");
    await db.as(U.manager, "update public.products set unit_price = 3550, active = false where id = $1", [p.id]);
    expect(await db.one("select unit_price::float, active from public.products where id = $1", [p.id]))
      .toEqual({ unit_price: 3550, active: false });
    await expectDbError(db.as(U.manager,
      "insert into public.products (sku, name, unit_price) values ('DAL-30KG', 'Dup', 1)"), "23505");
    await expectDbError(db.as(U.manager,
      "insert into public.products (sku, name, unit_price) values ('bad sku', 'x y', 1)"), "23514");
    await expectDbError(db.as(U.manager,
      "insert into public.products (sku, name, unit_price) values ('FREE-1', 'Free thing', 0)"), "23514");
  });

  it("manager creates customers; GSTIN format is enforced", async () => {
    const [c] = await db.as(U.manager,
      "insert into public.customers (name, gstin, credit_limit) values ('Kota Traders', '08KOTAX1234A1Z9', 25000) returning id");
    expect(c.id).toBeTruthy();
    await expectDbError(db.as(U.manager,
      "insert into public.customers (name, gstin) values ('Bad GST', 'NOT-A-GSTIN')"), "23514");
    await expectDbError(db.as(U.sales, "insert into public.customers (name) values ('Sneaky Co')"), "42501");
  });
});
