// Runs once, before any test file. Cluster-wide roles must exist before parallel
// files apply the auth shim, otherwise concurrent CREATE ROLE races (seen in CI).
import pg from "pg";

export default async function setup() {
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:54329/postgres" });
  await c.connect();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rowCount } = await c.query("select 1 from pg_roles where rolname = $1", [role]);
      if (!rowCount) await c.query(`create role ${role} nologin`);
    }
  } finally {
    await c.end();
  }
}
