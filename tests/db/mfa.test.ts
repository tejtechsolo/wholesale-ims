import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { C, P, U, WH, createTestDb, expectDbError, items, placeOrder, type TestDb } from "../helpers/db";

let db: TestDb;
let orderId: string;
beforeAll(async () => {
  db = await createTestDb();
  orderId = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
});
afterAll(async () => { await db?.close(); });

const aal1 = { aal: "aal1" as const };

describe("MFA required for admin and manager", () => {
  it("a manager without MFA (aal1) has no role: business functions refuse", async () => {
    // Functions that check "has any role" first answer UNAUTHENTICATED, the others FORBIDDEN;
    // either way nothing happens. The app's guard shows the friendly MFA_REQUIRED message.
    await expectDbError(db.as(U.manager, "select public.transition_order($1, 'approved')", [orderId], aal1), "UNAUTHENTICATED");
    await expectDbError(db.as(U.manager, "select public.adjust_stock($1, $2, -1, 'count')", [P.oil, WH], aal1), "FORBIDDEN");
    await expectDbError(db.as(U.manager, "select public.place_order($1, $2::jsonb, gen_random_uuid())",
      [C.A, items([P.oil, 1])], aal1), "UNAUTHENTICATED");
  });

  it("…and RLS hides staff data from that session", async () => {
    expect(await db.as(U.manager, "select 1 from public.inventory", [], aal1)).toEqual([]);
    expect(await db.as(U.manager, "select 1 from public.orders", [], aal1)).toEqual([]);
    expect(await db.as(U.admin, "select id from public.profiles", [], aal1)).toEqual([{ id: U.admin }]); // own row only
    await expectDbError(db.as(U.admin, "select * from public.admin_list_users()", [], aal1), "FORBIDDEN");
    expect(await db.as(U.manager, "update public.products set unit_price = 1 returning id", [], aal1)).toEqual([]);
  });

  it("a missing aal claim counts as aal1", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("begin; set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [U.admin]);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.admin })]);
      expect((await c.query("select public.current_app_role() as r")).rows[0].r).toBeNull();
    } finally {
      await c.query("rollback"); c.release();
    }
  });

  it("with MFA (aal2) the same manager works normally", async () => {
    await db.as(U.manager, "select public.transition_order($1, 'approved')", [orderId]);
    expect((await db.as(U.manager, "select 1 from public.inventory")).length).toBeGreaterThan(0);
  });

  it("other roles are unaffected by aal1", async () => {
    await expect(placeOrder(db, U.buyerA, C.A, items([P.oil, 1]))).resolves.toBeTruthy();
    await expect(db.as(U.warehouse, "select public.receive_stock($1, $2, 1)", [P.oil, WH], aal1)).resolves.toBeTruthy();
    await expect(db.as(U.sales, "select 1 from public.orders", [], aal1)).resolves.not.toEqual([]);
  });
});
