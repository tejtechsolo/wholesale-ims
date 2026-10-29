import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { C, P, U, WH, WH2, WH_CLOSED, createTestDb, expectDbError, items, placeOrder, stock, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

const transfer = (uid: string, qty: number, from = WH, to = WH2, product = P.rice) =>
  db.as(uid, "select public.transfer_stock($1, $2, $3, $4, 'rebalance')", [product, from, to, qty]);

describe("transfer_stock", () => {
  it("moves units between warehouses, creating the destination row, with two ledger rows", async () => {
    const src0 = await stock(db, P.rice);
    await transfer(U.warehouse, 30);
    expect((await stock(db, P.rice)).on_hand).toBe(src0.on_hand - 30);
    expect(await stock(db, P.rice, WH2)).toEqual({ on_hand: 30, reserved: 0 });
    const mv = await db.pool.query(
      "select warehouse_id, quantity from public.stock_movements where type = 'transfer' order by quantity");
    expect(mv.rows).toEqual([{ warehouse_id: WH, quantity: -30 }, { warehouse_id: WH2, quantity: 30 }]);
  });

  it("only moves free stock: reserved units stay for their orders", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 8])); // oil: 10 on hand, 8 reserved
    const e = await expectDbError(transfer(U.manager, 3, WH, WH2, P.oil), "INSUFFICIENT_STOCK");
    expect(JSON.parse(e.detail)).toEqual({ available: 2, requested: 3 });
    await transfer(U.manager, 2, WH, WH2, P.oil);
    expect(await stock(db, P.oil)).toEqual({ on_hand: 8, reserved: 8 });
    await db.as(U.buyerA, "select public.transition_order($1, 'cancelled')", [id]);
  });

  it("is atomic: a failed transfer changes nothing and leaves no empty destination row", async () => {
    await expectDbError(transfer(U.warehouse, 1, WH, WH2, P.nostock), "INVENTORY_NOT_FOUND");
    const r = await db.pool.query("select 1 from public.inventory where product_id = $1", [P.nostock]);
    expect(r.rowCount).toBe(0);
  });

  it("validates input and roles", async () => {
    await expectDbError(transfer(U.warehouse, 0), "VALIDATION");
    await expectDbError(transfer(U.warehouse, 5, WH, WH), "VALIDATION");
    await expectDbError(transfer(U.warehouse, 5, WH, WH_CLOSED), "VALIDATION");
    await expectDbError(transfer(U.sales, 5), "FORBIDDEN");
    await expectDbError(transfer(U.buyerA, 5), "FORBIDDEN");
  });

  it("opposite-direction transfers running concurrently never deadlock or go negative", async () => {
    const total0 = (await stock(db, P.rice)).on_hand + (await stock(db, P.rice, WH2)).on_hand;
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      i % 2 ? transfer(U.warehouse, 5, WH, WH2) : transfer(U.warehouse, 5, WH2, WH)));
    const unexpected = results
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason.message)
      .filter((m) => m !== "INSUFFICIENT_STOCK");
    expect(unexpected).toEqual([]);
    const a = await stock(db, P.rice), b = await stock(db, P.rice, WH2);
    expect(a.on_hand + b.on_hand).toBe(total0); // stock conserved
    expect(Math.min(a.on_hand, b.on_hand)).toBeGreaterThanOrEqual(0);
  });
});

describe("reorder levels and low-stock report", () => {
  it("only managers/admins set reorder levels; levels must be >= 0", async () => {
    await expectDbError(db.as(U.warehouse, "select public.set_reorder_level($1, $2, 50)", [P.rice, WH]), "FORBIDDEN");
    await expectDbError(db.as(U.manager, "select public.set_reorder_level($1, $2, -1)", [P.rice, WH]), "VALIDATION");
    await expectDbError(db.as(U.manager, "select public.set_reorder_level($1, $2, 5)", [P.nostock, WH]),
      "INVENTORY_NOT_FOUND");
  });

  it("reports products whose AVAILABLE stock is at or below the level, worst first", async () => {
    const rice = await stock(db, P.rice);
    await db.as(U.manager, "select public.set_reorder_level($1, $2, $3)", [P.rice, WH, rice.on_hand - rice.reserved + 10]);
    await db.as(U.manager, "select public.set_reorder_level($1, $2, 1000)", [P.oil, WH]);
    await db.as(U.manager, "select public.set_reorder_level($1, $2, 1)", [P.old, WH]); // inactive product

    const rows = await db.as(U.warehouse, "select sku, warehouse_code, shortfall from public.low_stock_report()");
    expect(rows.map((r) => r.sku)).toEqual(["OIL-15L", "RICE-25KG"]); // oil's shortfall is larger
    expect(rows[1]).toEqual({ sku: "RICE-25KG", warehouse_code: "JAI-01", shortfall: 10 });
  });

  it("counts reservations: an order can push a product onto the report, cancelling removes it", async () => {
    await db.as(U.manager, "select public.set_reorder_level($1, $2, 0)", [P.rice, WH]);
    await db.as(U.warehouse, "select public.receive_stock($1, $2, 50)", [P.rice, WH2]); // guarantee free >= 5
    const s = await stock(db, P.rice, WH2);
    const free = s.on_hand - s.reserved;
    await db.as(U.manager, "select public.set_reorder_level($1, $2, $3)", [P.rice, WH2, free - 1]);
    const report = () => db.as(U.manager, "select sku from public.low_stock_report() where warehouse_code = 'AJM-01'");
    expect(await report()).toEqual([]);
    const id = await placeOrder(db, U.buyerA, C.A,
      JSON.stringify([{ product_id: P.rice, warehouse_id: WH2, quantity: 5 }]));
    expect(await report()).toEqual([{ sku: "RICE-25KG" }]);
    await db.as(U.buyerA, "select public.transition_order($1, 'cancelled')", [id]);
    expect(await report()).toEqual([]);
  });

  it("is hidden from buyers", async () => {
    await expectDbError(db.as(U.buyerA, "select * from public.low_stock_report()"), "FORBIDDEN");
    await expectDbError(db.as(null, "select * from public.low_stock_report()"), "FORBIDDEN");
  });
});
