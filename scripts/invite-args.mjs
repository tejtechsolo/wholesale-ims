// Pure argument parsing/validation for invite-user.mjs (unit tested).
export const ROLES = ["admin", "manager", "warehouse", "sales", "customer"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInviteArgs(argv, env = {}) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) throw new Error(`unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`missing value for ${k}`);
    a[k.slice(2)] = v; i++;
  }
  const allowed = ["email", "role", "name", "customer", "password"];
  for (const k of Object.keys(a)) if (!allowed.includes(k)) throw new Error(`unknown option --${k}`);
  const email = (a.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("--email must be a valid email");
  if (!ROLES.includes(a.role)) throw new Error(`--role must be one of ${ROLES.join(", ")}`);
  const name = (a.name ?? "").trim();
  if (name.length < 2 || name.length > 100) throw new Error("--name must be 2-100 characters");
  if (a.role === "customer" && !UUID.test(a.customer ?? "")) throw new Error("--customer <uuid> is required for role customer");
  if (a.role !== "customer" && a.customer) throw new Error("--customer is only valid with --role customer");
  if (a.password !== undefined) {
    // Direct passwords skip the email invite: allowed only against a local stack.
    const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) throw new Error("--password is only allowed for a local Supabase URL");
    if (a.password.length < 8) throw new Error("--password must be at least 8 characters");
  }
  for (const v of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) if (!env[v]) throw new Error(`env ${v} is required`);
  if (a.password === undefined && !env.SITE_URL) throw new Error("env SITE_URL is required for email invites");
  return { email, role: a.role, name, customerId: a.role === "customer" ? a.customer : null, password: a.password ?? null };
}
