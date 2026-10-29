// Creates the seed users through the real Auth admin API (so they can sign in with a
// password), then loads business fixtures. Idempotent enough for local re-runs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { PASSWORD, USERS } from "./fixtures";

export default async function globalSetup() {
  const url = must("NEXT_PUBLIC_SUPABASE_URL");
  const secret = must("SUPABASE_SECRET_KEY");
  for (const u of Object.values(USERS)) {
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, email: u.email, password: PASSWORD, email_confirm: true }),
    });
    if (!res.ok && res.status !== 422) {  // 422 = already exists (local re-run)
      throw new Error(`create user ${u.email}: ${res.status} ${await res.text()}`);
    }
  }
  const db = new pg.Client({ connectionString: must("SUPABASE_DB_URL") });
  await db.connect();
  try {
    const seeded = await db.query("select 1 from public.customers limit 1");
    if (!seeded.rowCount) await db.query(readFileSync(join(import.meta.dirname, "..", "supabase/seed.test.sql"), "utf8"));
  } finally {
    await db.end();
  }
}

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`E2E needs env ${name}`);
  return v;
}
