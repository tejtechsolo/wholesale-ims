#!/usr/bin/env node
// Remove ALL MFA factors of one user (lost phone). They must enrol again at next sign-in;
// for admin/manager the app forces that before anything else works.
//   node --env-file=.env.local scripts/reset-mfa.mjs --email manager@example.com
// Needs SUPABASE_SECRET_KEY: trusted machine only. Verify the person's identity first.
import { createClient } from "@supabase/supabase-js";
import { parseResetArgs } from "./invite-args.mjs";

let args;
try {
  args = parseResetArgs(process.argv.slice(2), process.env);
} catch (e) {
  console.error(`reset-mfa: ${e.message}`);
  process.exit(2);
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error(`reset-mfa: ${error.message}`); process.exit(1); }
  user = data.users.find((u) => u.email?.toLowerCase() === args.email) ?? null;
  if (data.users.length < 1000) break;
}
if (!user) { console.error(`reset-mfa: no user ${args.email}`); process.exit(1); }

const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
if (error) { console.error(`reset-mfa: ${error.message}`); process.exit(1); }
for (const f of factors.factors) {
  const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: f.id });
  if (delError) { console.error(`reset-mfa: could not delete factor ${f.id}: ${delError.message}`); process.exit(1); }
}
console.log(JSON.stringify({ ok: true, userId: user.id, removed: factors.factors.length }));
