import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { C, P, U, createTestDb, expectDbError, items, placeOrder, stock, transition, type TestDb } from "../helpers/db";
import { ORDER_STATUSES, ROLES, canTransition } from "../../src/lib/domain";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

const outstanding = async (c: string) =>
  Number((await db.one("select outstanding from public.customers where id = $1", [c])).outstanding);

describe("order workflow", () => {
  it("runs the full lifecycle and only deducts on_hand at shipping", async () => {
    const s0 = await stock(db, P.rice);
    const o0 = await outstanding(C.A);
    const id = await placeOrder(db, U.buyerA, C.A, items([P.rice, 20]));

    await transition(db, U.manager, id, "approved");
    expect(await outstanding(C.A)).toBe(o0 + 24000);
    await transition(db, U.warehouse, id, "picking");
    expect(await stock(db, P.rice)).toEqual({ on_hand: s0.on_hand, reserved: s0.reserved + 20 });

    await transition(db, U.warehouse, id, "shipped");
    expect(await stock(db, P.rice)).toEqual({ on_hand: s0.on_hand - 20, reserved: s0.reserved });
    await transition(db, U.warehouse, id, "delivered");

    const hist = await db.pool.query(
      "select from_status, to_status from public.order_status_history where order_id = $1 order by id", [id]);
    expect(hist.rows.map((r) => r.to_status)).toEqual(["submitted", "approved", "picking", "shipped", "delivered"]);
    const mv = await db.pool.query(
      "select type, quantity from public.stock_movements where order_id = $1 order by id", [id]);
    expect(mv.rows).toEqual([{ type: "reserve", quantity: 20 }, { type: "ship", quantity: -20 }]);
  });

  it("rejects skipped steps and unknown jumps", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
    await expectDbError(transition(db, U.admin, id, "shipped"), "INVALID_TRANSITION");
    await expectDbError(transition(db, U.admin, id, "submitted"), "INVALID_TRANSITION");
  });

  it("returns FORBIDDEN when the step exists but the role may not take it", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
    await expectDbError(transition(db, U.buyerA, id, "approved"), "FORBIDDEN");
    await expectDbError(transition(db, U.warehouse, id, "approved"), "FORBIDDEN");
    await expectDbError(transition(db, U.sales, id, "approved"), "FORBIDDEN");
  });

  it("cancelling a submitted order releases its reservation", async () => {
    const before = await stock(db, P.oil);
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 2]));
    expect((await stock(db, P.oil)).reserved).toBe(before.reserved + 2);
    await transition(db, U.buyerA, id, "cancelled");
    expect(await stock(db, P.oil)).toEqual(before);
  });

  it("cancelling an approved order also reverses the customer's outstanding balance", async () => {
    const o0 = await outstanding(C.A);
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
    await transition(db, U.manager, id, "approved");
    await expectDbError(transition(db, U.buyerA, id, "cancelled"), "FORBIDDEN");
    await transition(db, U.manager, id, "cancelled");
    expect(await outstanding(C.A)).toBe(o0);
  });

  it("cannot cancel after shipping", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
    for (const s of ["approved", "picking", "shipped"]) await transition(db, U.admin, id, s);
    await expectDbError(transition(db, U.admin, id, "cancelled"), "INVALID_TRANSITION");
  });

  it("blocks approval beyond the customer's credit limit", async () => {
    // Customer B: limit 5000. Two oil tins = 4200 fits; a third order would not.
    const ok = await placeOrder(db, U.buyerB, C.B, items([P.oil, 2]));
    await transition(db, U.manager, ok, "approved");
    const over = await placeOrder(db, U.buyerB, C.B, items([P.oil, 1]));
    const e = await expectDbError(transition(db, U.manager, over, "approved"), "CREDIT_LIMIT_EXCEEDED");
    expect(JSON.parse(e.detail)).toMatchObject({ limit: 5000 });
    expect((await db.one("select status from public.orders where id = $1", [over])).status).toBe("submitted");
    await transition(db, U.manager, over, "cancelled");
    await transition(db, U.manager, ok, "cancelled");
  });

  it("hides other customers' orders (same error as a missing order)", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
    await expectDbError(transition(db, U.buyerB, id, "cancelled"), "ORDER_NOT_FOUND");
    await expectDbError(transition(db, U.admin, "99999999-0000-4000-8000-000000000000", "approved"), "ORDER_NOT_FOUND");
    await transition(db, U.buyerA, id, "cancelled");
  });

  it("TypeScript transition table matches the SQL state machine for every combination", async () => {
    const mismatches: string[] = [];
    for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) for (const role of ROLES) {
      const sql = (await db.one(
        "select public.transition_allowed($1::public.order_status, $2::public.order_status, $3::public.app_role) as ok",
        [from, to, role])).ok;
      if (sql !== canTransition(from, to, role)) mismatches.push(`${from}>${to} as ${role}`);
    }
    expect(mismatches).toEqual([]);
  });
});
