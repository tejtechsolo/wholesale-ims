// Real parallel transactions on separate connections: proves the row locks
// in place_order/transition_order prevent overselling and deadlocks.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { C, P, U, WH, createTestDb, items, placeOrder, stock, transition, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe("concurrency", () => {
  it("never oversells: 20 simultaneous 1-unit orders against 10 in stock", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        placeOrder(db, i % 2 ? U.buyerA : U.sales, C.A, items([P.oil, 1]))),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toBe(10);
    expect(new Set(failures.map((f) => f.reason.message))).toEqual(new Set(["INSUFFICIENT_STOCK"]));
    expect(await stock(db, P.oil)).toEqual({ on_hand: 10, reserved: 10 });
  });

  it("no deadlocks when orders lock the same rows in opposite line order", async () => {
    await db.as(U.warehouse, "select public.receive_stock($1, $2, 500)", [P.oil, WH]);
    const forward = items([P.rice, 5], [P.oil, 1]);
    const reverse = items([P.oil, 1], [P.rice, 5]);
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) => placeOrder(db, U.sales, C.A, i % 2 ? forward : reverse)),
    );
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
                          .map((r) => `${r.reason.code}: ${r.reason.message}`);
    expect(errors).toEqual([]);
    expect((await stock(db, P.rice)).reserved).toBe(80);
  });

  it("idempotency holds under a double-submit race (same key, parallel)", async () => {
    const key = randomUUID();
    const before = (await stock(db, P.rice)).reserved;
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => placeOrder(db, U.buyerA, C.A, items([P.rice, 5]), key)));
    expect(new Set(ids).size).toBe(1);
    expect((await stock(db, P.rice)).reserved).toBe(before + 5);
  });

  it("two managers racing to approve/cancel the same order: exactly one wins", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.rice, 5]));
    const [a, b] = await Promise.allSettled([
      transition(db, U.manager, id, "approved"),
      transition(db, U.admin, id, "cancelled"),
    ]);
    const statuses = [a.status, b.status].sort();
    const final = (await db.one("select status from public.orders where id = $1", [id])).status;
    if (statuses.join() === "fulfilled,fulfilled") {
      // Approve ran first, then cancel (allowed from approved): must end cancelled and fully reversed.
      expect(final).toBe("cancelled");
    } else {
      expect(statuses).toEqual(["fulfilled", "rejected"]);
    }
    const hist = await db.pool.query("select count(*)::int as n from public.order_status_history where order_id = $1", [id]);
    expect(hist.rows[0].n).toBe(1 + statuses.filter((s) => s === "fulfilled").length);
    if (final === "cancelled") {
      const out = await db.one("select outstanding::float as o from public.customers where id = $1", [C.A]);
      expect(out.o).toBe(0);
    }
  });
});
