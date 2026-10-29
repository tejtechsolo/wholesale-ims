import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { U, createTestDb, expectDbError, type TestDb } from "../helpers/db";

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

const k = (s: string) => createHash("sha256").update(s).digest("hex");

/** Calls the function exactly as the sign-in action does: as `anon`, no session. */
async function throttle(pair: string, ip: string, event: string): Promise<boolean> {
  const c = await db.pool.connect();
  try {
    await c.query("begin; set local role anon");
    const r = await c.query("select public.login_throttle($1, $2, $3) as blocked", [pair, ip, event]);
    await c.query("commit");
    return r.rows[0].blocked;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

describe("login_throttle", () => {
  it("blocks a pair after 5 failures, and only that pair", async () => {
    const ip = k("ip-1"), pair = k("ip-1|victim"), other = k("ip-1|someone-else");
    expect(await throttle(pair, ip, "check")).toBe(false);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await throttle(pair, ip, "fail"));
    expect(results).toEqual([false, false, false, false, true]);
    expect(await throttle(pair, ip, "check")).toBe(true);
    expect(await throttle(other, ip, "check")).toBe(false); // same IP, different email
  });

  it("a successful sign-in clears the pair's failures", async () => {
    const ip = k("ip-2"), pair = k("ip-2|user");
    for (let i = 0; i < 4; i++) await throttle(pair, ip, "fail");
    await throttle(pair, ip, "success");
    expect(await throttle(pair, ip, "fail")).toBe(false); // counter restarted at 1
  });

  it("blocks an IP after 30 failures spread across many emails", async () => {
    const ip = k("ip-3");
    for (let i = 0; i < 29; i++) expect(await throttle(k(`ip-3|user-${i}`), ip, "fail")).toBe(false);
    expect(await throttle(k("ip-3|user-29"), ip, "fail")).toBe(true);
    expect(await throttle(k("ip-3|fresh-user"), ip, "check")).toBe(true);
    expect(await throttle(k("ip-4|fresh-user"), k("ip-4"), "check")).toBe(false); // other IP unaffected
  });

  it("the window expires after 15 minutes", async () => {
    const ip = k("ip-5"), pair = k("ip-5|user");
    for (let i = 0; i < 5; i++) await throttle(pair, ip, "fail");
    expect(await throttle(pair, ip, "check")).toBe(true);
    await db.pool.query("update public.login_failures set window_start = now() - interval '16 minutes' where key in ($1, $2)", [pair, ip]);
    expect(await throttle(pair, ip, "check")).toBe(false);
    expect(await throttle(pair, ip, "fail")).toBe(false); // new window starts at 1
    expect((await db.one("select failures from public.login_failures where key = $1", [pair])).failures).toBe(1);
  });

  it("concurrent failures are all counted (no lost updates)", async () => {
    const ip = k("ip-6"), pair = k("ip-6|user");
    await Promise.all(Array.from({ length: 20 }, () => throttle(pair, ip, "fail")));
    expect((await db.one("select failures from public.login_failures where key = $1", [pair])).failures).toBe(20);
  });

  it("rejects malformed keys and events (only opaque digests are stored)", async () => {
    await expectDbError(throttle("alice@example.com", k("x"), "fail"), "VALIDATION");
    await expectDbError(throttle(k("a"), k("a"), "fail"), "VALIDATION");
    await expectDbError(throttle(k("a"), k("b"), "reset-all"), "VALIDATION");
  });

  it("the table is unreachable from the API roles", async () => {
    await expectDbError(db.as(U.admin, "select * from public.login_failures"), "42501");
    await expectDbError(db.as(U.admin, "delete from public.login_failures"), "42501");
  });
});
