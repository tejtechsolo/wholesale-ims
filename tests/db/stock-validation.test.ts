import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { C, P, U, createTestDb, expectDbError, items, placeOrder, stock, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe("place_order: stock validation", () => {
  it("reserves stock and prices lines from the database, not the client", async () => {
    const before = await stock(db, P.rice);
    const lines = JSON.stringify([{ product_id: P.rice, warehouse_id: "20000000-0000-4000-8000-000000000001",
                                    quantity: 10, unit_price: 1 /* ignored */ }]);
    const id = await placeOrder(db, U.buyerA, C.A, lines);
    const order = await db.one("select status, total::float as total from public.orders where id = $1", [id]);
    expect(order).toEqual({ status: "submitted", total: 12000 });
    const line = await db.one("select unit_price::float as p from public.order_items where order_id = $1", [id]);
    expect(line.p).toBe(1200);
    const after = await stock(db, P.rice);
    expect(after.on_hand).toBe(before.on_hand);
    expect(after.reserved).toBe(before.reserved + 10);
    const mv = await db.one("select type, quantity from public.stock_movements where order_id = $1", [id]);
    expect(mv).toEqual({ type: "reserve", quantity: 10 });
  });

  it("rejects quantities above available and reserves nothing (all-or-nothing)", async () => {
    const riceBefore = await stock(db, P.rice);
    const e = await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.rice, 5], [P.oil, 11])), "INSUFFICIENT_STOCK");
    expect(JSON.parse(e.detail)).toMatchObject({ sku: "OIL-15L", requested: 11 });
    expect(await stock(db, P.rice)).toEqual(riceBefore);
    expect((await stock(db, P.oil)).reserved).toBe(0);
  });

  it("counts already-reserved stock as unavailable", async () => {
    const { on_hand, reserved } = await stock(db, P.rice);
    const free = on_hand - reserved;
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.rice, free + 5])), "INSUFFICIENT_STOCK");
  });

  it("treats a product with no inventory row as out of stock", async () => {
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.nostock, 1])), "INSUFFICIENT_STOCK");
  });

  it("enforces minimum order quantity and pack size", async () => {
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.rice, 3])), "BELOW_MIN_ORDER_QTY");
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.rice, 7])), "NOT_PACK_MULTIPLE");
  });

  it("rejects inactive and unknown products", async () => {
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.old, 1])), "PRODUCT_INACTIVE");
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([randomUUID(), 1])), "PRODUCT_NOT_FOUND");
  });

  it("rejects empty, zero and negative quantities", async () => {
    await expectDbError(placeOrder(db, U.buyerA, C.A, "[]"), "VALIDATION");
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.oil, 0])), "VALIDATION");
    await expectDbError(placeOrder(db, U.buyerA, C.A, items([P.oil, -2])), "VALIDATION");
  });

  it("merges duplicate lines for the same product before validating", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1], [P.oil, 2]));
    const rows = await db.pool.query("select quantity from public.order_items where order_id = $1", [id]);
    expect(rows.rows).toEqual([{ quantity: 3 }]);
  });

  it("is idempotent: retrying with the same key returns the same order and reserves once", async () => {
    const key = randomUUID();
    const before = (await stock(db, P.oil)).reserved;
    const a = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]), key);
    const b = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]), key);
    expect(b).toBe(a);
    expect((await stock(db, P.oil)).reserved).toBe(before + 1);
  });
});

describe("place_order: who may order", () => {
  it("blocks a buyer from ordering on another customer's account", async () => {
    await expectDbError(placeOrder(db, U.buyerA, C.B, items([P.oil, 1])), "FORBIDDEN");
  });
  it("lets sales staff order on behalf of any customer", async () => {
    await expect(placeOrder(db, U.sales, C.B, items([P.oil, 1]))).resolves.toBeTypeOf("string");
  });
  it("blocks warehouse staff from placing orders", async () => {
    await expectDbError(placeOrder(db, U.warehouse, C.A, items([P.oil, 1])), "FORBIDDEN");
  });
  it("blocks anonymous callers and users without a profile", async () => {
    await expectDbError(db.as(null, "select public.place_order($1, $2::jsonb, $3)",
      [C.A, items([P.oil, 1]), randomUUID()]), "UNAUTHENTICATED");
    await expectDbError(placeOrder(db, U.pending, C.A, items([P.oil, 1])), "UNAUTHENTICATED");
  });
  it("blocks orders for a deactivated customer account", async () => {
    await db.pool.query("update public.customers set active = false where id = $1", [C.B]);
    try {
      await expectDbError(placeOrder(db, U.sales, C.B, items([P.oil, 1])), "CUSTOMER_INACTIVE");
    } finally {
      await db.pool.query("update public.customers set active = true where id = $1", [C.B]);
    }
  });
});
