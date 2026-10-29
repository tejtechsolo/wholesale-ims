// Test harness: a real PostgreSQL database per test file, built from the
// migrations, with Supabase's auth.uid() emulated via a session setting.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres";
const root = join(import.meta.dirname, "..", "..");

export const U = {
  admin: "00000000-0000-4000-8000-000000000001",
  manager: "00000000-0000-4000-8000-000000000002",
  warehouse: "00000000-0000-4000-8000-000000000003",
  sales: "00000000-0000-4000-8000-000000000004",
  buyerA: "00000000-0000-4000-8000-00000000000a",
  buyerB: "00000000-0000-4000-8000-00000000000b",
  pending: "00000000-0000-4000-8000-0000000000ff", // signed up, no profile yet
} as const;
export const C = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };
export const WH = "20000000-0000-4000-8000-000000000001";
export const WH2 = "20000000-0000-4000-8000-000000000002";
export const WH_CLOSED = "20000000-0000-4000-8000-000000000003";
export const P = {
  rice: "30000000-0000-4000-8000-000000000001", // ₹1200, MOQ 5, pack 5, 100 on hand
  oil: "30000000-0000-4000-8000-000000000002",  // ₹2100, MOQ 1, pack 1, 10 on hand
  old: "30000000-0000-4000-8000-000000000003",  // inactive
  nostock: "30000000-0000-4000-8000-000000000004", // active, no inventory row
};

function urlFor(db: string) {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${db}`;
  return u.toString();
}

export interface TestDb {
  name: string;
  pool: pg.Pool;                     // superuser connections (setup / assertions)
  as: <T = any>(uid: string | null, sql: string, params?: unknown[]) => Promise<T[]>;
  one: <T = any>(sql: string, params?: unknown[]) => Promise<T>;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `ims_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: urlFor(name), max: 25 });
  // `drop database ... with (force)` in close() terminates any socket still shutting down
  // (FATAL 57P01). Without a listener pg rethrows it as an uncaught exception (seen in CI).
  // Ignore only that expected shutdown error, and only once close() has started.
  let closing = false;
  const onError = (e: Error & { code?: string }) => {
    if (closing && e.code === "57P01") return;
    console.error("[test db] unexpected connection error", e);
  };
  pool.on("error", onError);
  pool.on("connect", (client) => client.on("error", onError));
  const migrations = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  await pool.query(readFileSync(join(root, "tests/helpers/auth-shim.sql"), "utf8"));
  for (const f of migrations) await pool.query(readFileSync(join(root, "supabase/migrations", f), "utf8"));
  await pool.query(readFileSync(join(root, "supabase/seed.test.sql"), "utf8"));

  /** Run one statement exactly as PostgREST would for a signed-in user. */
  const as = async <T,>(uid: string | null, sql: string, params: unknown[] = []) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? ""]);
      const r = await c.query(sql, params);
      await c.query("commit");
      return r.rows as T[];
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  };

  const one = async <T,>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows[0] as T;

  const close = async () => {
    closing = true;
    await pool.end();
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${name} with (force)`);
    await a.end();
  };

  return { name, pool, as, one, close };
}

export const items = (...lines: [string, number][]) =>
  JSON.stringify(lines.map(([product_id, quantity]) => ({ product_id, warehouse_id: WH, quantity })));

export const placeOrder = (db: TestDb, uid: string, customer: string, lines: string, key = randomUUID()) =>
  db.as<{ id: string }>(uid, "select public.place_order($1, $2::jsonb, $3) as id", [customer, lines, key])
    .then((r) => r[0].id);

export const transition = (db: TestDb, uid: string, orderId: string, to: string) =>
  db.as(uid, "select public.transition_order($1, $2::public.order_status)", [orderId, to]);

export const stock = (db: TestDb, product: string, warehouse = WH) =>
  db.one<{ on_hand: number; reserved: number }>(
    "select on_hand, reserved from public.inventory where product_id = $1 and warehouse_id = $2", [product, warehouse]);

/** Asserts a promise rejects with our P0001 error code. */
export async function expectDbError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e: any) {
    if (e.message !== code && e.code !== code)
      throw new Error(`expected ${code}, got ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error(`expected ${code}, but it succeeded`);
}
