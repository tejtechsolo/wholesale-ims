import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { C, P, U, createTestDb, expectDbError, items, placeOrder, transition, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

/** Place → approve → pick → ship. Returns the order id. */
async function shippedOrder(customer: string, buyer: string, lines: string) {
  const id = await placeOrder(db, buyer, customer, lines);
  for (const s of ["approved", "picking", "shipped"]) await transition(db, U.manager, id, s);
  return id;
}
const pay = (uid: string, customer: string, amount: number | string, key = randomUUID(), method = "upi") =>
  db.as<{ id: string }>(uid, "select public.record_payment($1, $2, $3::public.payment_method, 'UTR-1', $4) as id",
    [customer, amount, method, key]).then((r) => r[0].id);
const outstanding = async (c: string) =>
  Number((await db.one("select outstanding from public.customers where id = $1", [c])).outstanding);
const invoice = (orderId: string) =>
  db.one("select invoice_number, amount::float, amount_paid::float, status, due_date::text from public.invoices where order_id = $1", [orderId]);

describe("invoice issuing", () => {
  it("issues exactly one invoice when an order ships, due after the customer's payment terms", async () => {
    await db.pool.query("update public.customers set payment_terms_days = 15 where id = $1", [C.A]);
    const id = await placeOrder(db, U.buyerA, C.A, items([P.rice, 10]));
    await transition(db, U.manager, id, "approved");
    await transition(db, U.warehouse, id, "picking");
    expect(await db.one("select count(*)::int as n from public.invoices where order_id = $1", [id])).toEqual({ n: 0 });
    await transition(db, U.warehouse, id, "shipped");
    const inv = await invoice(id);
    const expectedDue = (await db.one(
      "select ((now() at time zone 'Asia/Kolkata')::date + 15)::text as d")).d;
    expect(inv).toMatchObject({ amount: 12000, amount_paid: 0, status: "open", due_date: expectedDue });
    expect(inv.invoice_number).toMatch(/^INV-\d+$/);
    await transition(db, U.warehouse, id, "delivered");
    expect(await db.one("select count(*)::int as n from public.invoices where order_id = $1", [id])).toEqual({ n: 1 });
  });

  it("never invoices cancelled orders", async () => {
    const id = await placeOrder(db, U.buyerA, C.A, items([P.oil, 1]));
    await transition(db, U.manager, id, "approved");
    await transition(db, U.manager, id, "cancelled");
    expect(await db.one("select count(*)::int as n from public.invoices where order_id = $1", [id])).toEqual({ n: 0 });
  });
});

describe("record_payment", () => {
  it("settles open invoices oldest-first and reduces outstanding", async () => {
    const before = await outstanding(C.B); // B: limit 5000
    const o1 = await shippedOrder(C.B, U.buyerB, items([P.oil, 1])); // 2100
    const o2 = await shippedOrder(C.B, U.buyerB, items([P.oil, 1])); // 2100
    expect(await outstanding(C.B)).toBe(before + 4200);

    await pay(U.manager, C.B, 3000);
    expect(await invoice(o1)).toMatchObject({ amount_paid: 2100, status: "paid" });
    expect(await invoice(o2)).toMatchObject({ amount_paid: 900, status: "open" });
    expect(await outstanding(C.B)).toBe(before + 1200);

    await pay(U.admin, C.B, "1200.00");
    expect(await invoice(o2)).toMatchObject({ amount_paid: 2100, status: "paid" });
    expect(await outstanding(C.B)).toBe(before);
  });

  it("payment frees credit: an approval blocked by the limit succeeds after paying", async () => {
    const a = await shippedOrder(C.B, U.buyerB, items([P.oil, 2])); // 4200 of 5000
    const next = await placeOrder(db, U.buyerB, C.B, items([P.oil, 1]));
    await expectDbError(transition(db, U.manager, next, "approved"), "CREDIT_LIMIT_EXCEEDED");
    await pay(U.manager, C.B, 4200);
    await transition(db, U.manager, next, "approved");
    expect((await invoice(a)).status).toBe("paid");
    await transition(db, U.manager, next, "cancelled");
  });

  it("rejects paying more than is due, and invalid amounts", async () => {
    const o = await shippedOrder(C.B, U.buyerB, items([P.oil, 1]));
    const e = await expectDbError(pay(U.manager, C.B, 2100.01), "PAYMENT_EXCEEDS_DUE");
    expect(JSON.parse(e.detail)).toMatchObject({ due: 2100 });
    await expectDbError(pay(U.manager, C.B, 0), "VALIDATION");
    await expectDbError(pay(U.manager, C.B, -5), "VALIDATION");
    await expectDbError(pay(U.manager, C.B, "10.005"), "VALIDATION");
    await expectDbError(pay(U.manager, randomUUID(), 10), "CUSTOMER_NOT_FOUND");
    await pay(U.manager, C.B, 2100);
    expect((await invoice(o)).status).toBe("paid");
  });

  it("only managers and admins record payments", async () => {
    for (const u of [U.sales, U.warehouse, U.buyerA, U.pending])
      await expectDbError(pay(u, C.A, 1), "FORBIDDEN");
  });

  it("is idempotent: a retried submission records one payment", async () => {
    await shippedOrder(C.B, U.buyerB, items([P.oil, 1]));
    const key = randomUUID();
    const before = await outstanding(C.B);
    const [x, y] = [await pay(U.manager, C.B, 500, key), await pay(U.manager, C.B, 500, key)];
    expect(y).toBe(x);
    expect(await outstanding(C.B)).toBe(before - 500);
    await pay(U.manager, C.B, 1600);
  });

  it("concurrent payments for one customer never over-settle", async () => {
    await shippedOrder(C.B, U.buyerB, items([P.oil, 2])); // 4200 due
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => pay(U.manager, C.B, 700)));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const errs = new Set(results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => r.reason.message));
    expect(ok).toBe(6);
    expect(errs).toEqual(new Set(["PAYMENT_EXCEEDS_DUE"]));
    const r = await db.one(`select coalesce(sum(amount - amount_paid), 0)::float as due,
                                   bool_and(amount_paid <= amount) as sane
                              from public.invoices where customer_id = $1`, [C.B]);
    expect(r).toEqual({ due: 0, sane: true });
    // allocations always add up to their payment
    const mismatched = await db.pool.query(`
      select p.id from public.payments p join public.payment_allocations a on a.payment_id = p.id
       group by p.id, p.amount having sum(a.amount) <> p.amount`);
    expect(mismatched.rowCount).toBe(0);
  });
});

describe("invoices/payments security", () => {
  it("buyers see only their own invoices and payments; staff (not warehouse) see all", async () => {
    const mine = await db.as(U.buyerA, "select distinct customer_id from public.invoices");
    expect(mine).toEqual([{ customer_id: C.A }]);
    expect(await db.as(U.buyerA, "select 1 from public.payments where customer_id = $1", [C.B])).toEqual([]);
    expect(await db.as(U.buyerA, "select 1 from public.payment_allocations a join public.payments p on p.id = a.payment_id where p.customer_id = $1", [C.B])).toEqual([]);
    expect((await db.as(U.sales, "select distinct customer_id from public.invoices")).length).toBe(2);
    expect(await db.as(U.warehouse, "select 1 from public.invoices")).toEqual([]);
  });

  it("no client can write invoices/payments directly", async () => {
    for (const u of [U.admin, U.manager, U.buyerA]) {
      await expectDbError(db.as(u, "update public.invoices set status = 'paid', amount_paid = amount"), "42501");
      await expectDbError(db.as(u,
        "insert into public.payments (customer_id, amount, method, idempotency_key, recorded_by) values ($1, 1, 'cash', gen_random_uuid(), $2)",
        [C.A, u]), "42501");
    }
  });

  it("payments and allocations are append-only even for the DB owner", async () => {
    await expectDbError(db.pool.query("update public.payments set amount = 1"), "42501");
    await expectDbError(db.pool.query("delete from public.payment_allocations"), "42501");
  });

  it("a manager can set payment terms; a buyer cannot", async () => {
    const r = await db.as(U.manager, "update public.customers set payment_terms_days = 45 where id = $1 returning payment_terms_days", [C.A]);
    expect(r).toEqual([{ payment_terms_days: 45 }]);
    expect(await db.as(U.buyerA, "update public.customers set payment_terms_days = 365 returning id")).toEqual([]);
    await expectDbError(db.as(U.manager, "update public.customers set payment_terms_days = 999 where id = $1", [C.A]), "23514");
  });
});
