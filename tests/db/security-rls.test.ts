import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { C, P, U, WH, createTestDb, expectDbError, items, placeOrder, stock, type TestDb } from "../helpers/db";

let db: TestDb;
let orderA: string;
let orderB: string;
beforeAll(async () => {
  db = await createTestDb();
  orderA = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
  orderB = await placeOrder(db, U.buyerB, C.B, items([P.oil, 1]));
});
afterAll(async () => { await db?.close(); });

describe("RLS: reads", () => {
  it("buyers see only their own account's orders and items", async () => {
    const rows = await db.as(U.buyerA, "select id from public.orders");
    expect(rows.map((r) => r.id)).toEqual([orderA]);
    expect(await db.as(U.buyerA, "select 1 from public.order_items where order_id = $1", [orderB])).toEqual([]);
  });

  it("staff see all orders", async () => {
    for (const u of [U.admin, U.manager, U.sales, U.warehouse]) {
      expect((await db.as(u, "select id from public.orders")).length).toBe(2);
    }
  });

  it("buyers cannot read raw inventory, the stock ledger, or other customers", async () => {
    expect(await db.as(U.buyerA, "select * from public.inventory")).toEqual([]);
    expect(await db.as(U.buyerA, "select * from public.stock_movements")).toEqual([]);
    expect((await db.as(U.buyerA, "select id from public.customers")).map((r) => r.id)).toEqual([C.A]);
  });

  it("buyers get availability through catalog_availability() without on_hand/reserved", async () => {
    const rows = await db.as(U.buyerA, "select * from public.catalog_availability() order by sku");
    expect(rows.map((r) => r.sku)).toEqual(["OIL-15L", "RICE-25KG"]); // inactive OLD-SKU hidden
    const oil = rows.find((r) => r.sku === "OIL-15L");
    expect(oil.available).toBe(8); // 10 on hand - 2 reserved
    expect(Object.keys(oil)).not.toContain("on_hand");
  });

  it("users without a profile and anonymous callers see nothing", async () => {
    expect(await db.as(U.pending, "select * from public.products")).toEqual([]);
    expect(await db.as(U.pending, "select * from public.catalog_availability()")).toEqual([]);
    expect(await db.as(null, "select * from public.orders")).toEqual([]);
  });

  it("a profile is visible to its owner; only admins list all profiles", async () => {
    expect((await db.as(U.buyerA, "select id from public.profiles")).length).toBe(1);
    expect((await db.as(U.admin, "select id from public.profiles")).length).toBe(6);
  });
});

describe("RLS + grants: writes", () => {
  it("nobody can write inventory or orders directly (must use the RPCs)", async () => {
    for (const u of [U.admin, U.manager, U.warehouse, U.buyerA]) {
      await expectDbError(db.as(u, "update public.inventory set on_hand = 999"), "42501");
      await expectDbError(db.as(u, "update public.orders set status = 'shipped'"), "42501");
      await expectDbError(db.as(u, "delete from public.orders"), "42501");
    }
    await expectDbError(db.as(U.buyerA,
      "insert into public.orders (customer_id, total, idempotency_key, created_by) values ($1, 0, gen_random_uuid(), $2)",
      [C.A, U.buyerA]), "42501");
  });

  it("buyers cannot change their own role or credit", async () => {
    await expectDbError(db.as(U.buyerA, "update public.profiles set role = 'admin'"), "42501");
    // credit_limit has a column grant (for managers), so RLS filters the buyer to 0 rows.
    expect(await db.as(U.buyerA, "update public.customers set credit_limit = 9999999 returning id")).toEqual([]);
    expect(Number((await db.one("select credit_limit from public.customers where id = $1", [C.A])).credit_limit))
      .toBe(100000);
  });

  it("customers.outstanding cannot be edited by any client, even a manager", async () => {
    await expectDbError(db.as(U.manager, "update public.customers set outstanding = 0"), "42501");
    const r = await db.as(U.manager, "update public.customers set credit_limit = 6000 where id = $1 returning credit_limit", [C.B]);
    expect(Number(r[0].credit_limit)).toBe(6000);
  });

  it("only managers/admins edit the catalog", async () => {
    expect(await db.as(U.sales, "update public.products set unit_price = 1 returning id")).toEqual([]);
    await expectDbError(db.as(U.buyerA,
      "insert into public.products (sku, name, unit_price) values ('HACK-1', 'x y', 1)"), "42501");
    const r = await db.as(U.manager, "update public.products set unit_price = 2200 where id = $1 returning unit_price", [P.oil]);
    expect(Number(r[0].unit_price)).toBe(2200);
  });

  it("role changes go through set_user_role(): admin only, never on yourself", async () => {
    await expectDbError(db.as(U.manager, "select public.set_user_role($1, 'admin')", [U.sales]), "FORBIDDEN");
    await expectDbError(db.as(U.admin, "select public.set_user_role($1, 'warehouse')", [U.admin]), "FORBIDDEN");
    await db.as(U.admin, "select public.set_user_role($1, 'manager')", [U.sales]);
    expect((await db.one("select role from public.profiles where id = $1", [U.sales])).role).toBe("manager");
    await db.as(U.admin, "select public.set_user_role($1, 'sales')", [U.sales]);
  });

  it("deactivated staff lose access immediately", async () => {
    await db.pool.query("update public.profiles set active = false where id = $1", [U.warehouse]);
    try {
      expect(await db.as(U.warehouse, "select * from public.inventory")).toEqual([]);
      await expectDbError(db.as(U.warehouse, "select public.receive_stock($1, $2, 5)", [P.oil, WH]), "FORBIDDEN");
    } finally {
      await db.pool.query("update public.profiles set active = true where id = $1", [U.warehouse]);
    }
  });

  it("the stock ledger and status history are append-only, even for the DB owner", async () => {
    await expectDbError(db.pool.query("update public.stock_movements set quantity = 1"), "42501");
    await expectDbError(db.pool.query("delete from public.order_status_history"), "42501");
  });

  it("anonymous role cannot execute business functions", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin; set local role anon");
      await expectDbError(c.query("select public.catalog_availability()"), "42501");
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("stock receiving and adjustments", () => {
  it("warehouse staff receive stock; sales and buyers cannot", async () => {
    const before = await stock(db, P.rice);
    await db.as(U.warehouse, "select public.receive_stock($1, $2, 25, 'PO-77')", [P.rice, WH]);
    expect((await stock(db, P.rice)).on_hand).toBe(before.on_hand + 25);
    await expectDbError(db.as(U.sales, "select public.receive_stock($1, $2, 5)", [P.rice, WH]), "FORBIDDEN");
    await expectDbError(db.as(U.buyerA, "select public.receive_stock($1, $2, 5)", [P.rice, WH]), "FORBIDDEN");
    await expectDbError(db.as(U.warehouse, "select public.receive_stock($1, $2, 0)", [P.rice, WH]), "VALIDATION");
  });

  it("adjustments need manager rights and a reason, and cannot cut into reserved stock", async () => {
    const { on_hand, reserved } = await stock(db, P.oil); // reserved = 2 from beforeAll
    await expectDbError(db.as(U.warehouse, "select public.adjust_stock($1, $2, -1, 'damaged')", [P.oil, WH]), "FORBIDDEN");
    await expectDbError(db.as(U.manager, "select public.adjust_stock($1, $2, -1, '')", [P.oil, WH]), "VALIDATION");
    await expectDbError(db.as(U.manager, "select public.adjust_stock($1, $2, $3, 'cycle count')",
      [P.oil, WH, -(on_hand - reserved + 1)]), "ADJUST_BELOW_RESERVED");
    await db.as(U.manager, "select public.adjust_stock($1, $2, -1, 'damaged tin')", [P.oil, WH]);
    expect(await stock(db, P.oil)).toEqual({ on_hand: on_hand - 1, reserved });
    const mv = await db.one(
      "select type, quantity, reason, actor_id from public.stock_movements where type = 'adjust' order by id desc limit 1");
    expect(mv).toEqual({ type: "adjust", quantity: -1, reason: "damaged tin", actor_id: U.manager });
  });

  it("the ledger always reconciles with on_hand", async () => {
    // on_hand = initial seed + sum(receive, adjust, ship). Reserve/release don't touch on_hand.
    const r = await db.one(`
      select i.on_hand,
             coalesce(sum(m.quantity) filter (where m.type in ('receive','adjust','ship')), 0)::int as moved
        from public.inventory i
        left join public.stock_movements m using (product_id, warehouse_id)
       where i.product_id = $1 group by i.on_hand`, [P.rice]);
    expect(r.on_hand - r.moved).toBe(100); // seeded opening balance
  });
});
