#!/usr/bin/env node
// Create a user account + profile (accounts are invite-only).
//   node --env-file=.env.local scripts/invite-user.mjs --email a@b.com --role manager --name "Asha"
//   ... --role customer --customer <customer uuid>
// Sends a Supabase invite email whose link lands on SITE_URL/auth/confirm → set password.
// Needs SUPABASE_SECRET_KEY: run only from a trusted machine, never from the web app.
import { createClient } from "@supabase/supabase-js";
import { parseInviteArgs } from "./invite-args.mjs";

let args;
try {
  args = parseInviteArgs(process.argv.slice(2), process.env);
} catch (e) {
  console.error(`invite-user: ${e.message}`);
  process.exit(2);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const created = args.password
  ? await admin.auth.admin.createUser({ email: args.email, password: args.password, email_confirm: true })
  : await admin.auth.admin.inviteUserByEmail(args.email, { redirectTo: `${process.env.SITE_URL}/account/password` });
if (created.error) {
  console.error(`invite-user: could not create ${args.email}: ${created.error.message}`);
  process.exit(1);
}
const userId = created.data.user.id;

const { error } = await admin.from("profiles").insert({
  id: userId, full_name: args.name, role: args.role, customer_id: args.customerId,
});
if (error) {
  // Don't leave a login without a profile behind.
  await admin.auth.admin.deleteUser(userId);
  console.error(`invite-user: profile failed (${error.message}); auth user removed`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, userId, email: args.email, role: args.role, invited: !args.password }));
