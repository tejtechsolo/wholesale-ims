# Decision log

Newest first. One entry per decision: date, decision, why, consequence. Append; don't rewrite.

## 2026-10-30 — Distinguish "not configured" / "unavailable" from a wrong password
First Vercel deploy had no Supabase env; every sign-in said "Invalid email or password". Now
missing or placeholder env shows a "not connected to its database" banner (no secrets
revealed) and the proxy no longer depends on Supabase to render /login; network/5xx Auth
failures say "temporarily unavailable" and aren't counted as failed attempts.

## 2026-10-30 — MFA enforced in the database for admin/manager
Redefining `current_app_role()` (one function behind every policy and business function)
makes an aal1 admin/manager session worthless even if an app check is missed. MFA is only
offered to roles that require it: other roles are never challenged at sign-in, so an
optional factor would only look secure. No self-service recovery yet.

## 2026-10-30 — App-level sign-in throttling
Sign-in runs on the Next server, so Supabase Auth sees one IP for all users. Failures are
counted per HMAC(client IP + email) and per HMAC(IP) with a server-only pepper; success
clears the pair. Fails open (logged) if the pepper or the check is unavailable, choosing
availability over lockout. Depends on a proxy that sets X-Forwarded-For reliably.

## 2026-10-30 — Accounts via invite script; links verified server-side
`scripts/invite-user.mjs` (secret key, trusted machine only) creates the auth user and the
profile, rolling back the user if the profile fails. Invite/reset emails link to
`/auth/confirm` with a `token_hash`; `verifyOtp` runs on the server, so no tokens sit in URL
fragments. Reset requests answer identically whether or not the email exists. The admin
console never holds the secret key: it changes roles/active flags through SECURITY DEFINER
functions and writes catalog/customer/warehouse rows through RLS.

## 2026-10-30 — Invoice at shipping, payments settle oldest invoices first
Invoice is issued by a trigger when an order becomes `shipped` (amount = order total, due =
ship date in IST + `payment_terms_days`). `record_payment` locks the customer row, then open
invoices by id, and allocates FIFO by due date. A payment may not exceed the open invoice
balance (no advances/unallocated credit yet). Payments reduce `outstanding`, freeing credit.
Not modelled yet: GST/tax lines, credit notes, refunds.

## 2026-10-30 — E2E only in CI, against a real local Supabase stack
Agent sessions have no Docker, so `supabase start` + Playwright run in the CI `e2e` job
(DB, Auth, PostgREST, gateway; other services excluded). retries = 0: flaky = bug. CI
publishes pass/fail counts as annotations because job logs are unreachable from sessions.

## 2026-10-30 — Project memory kept in the repo
`CLAUDE.md` (state, rules, next steps) + this log. Any session or developer reads the same
context; it is versioned and reviewed with the code it describes.

## 2026-10-30 — CSP with per-request nonce
Dropped `script-src 'unsafe-inline'`. Cost: every page renders dynamically (root layout
reads `headers()`), so no static prerendering. Acceptable: all pages are per-user anyway.

## 2026-10-30 — Transfers move only free stock
`transfer_stock` refuses units reserved for open orders, so a transfer can never strand an
order. Ledger records paired `transfer` rows rather than receive/adjust.

## 2026-10-29 — Business rules in Postgres, not Next.js
Stock check + reservation must run under a row lock in one transaction; a JS pre-check is
stale by the time it writes. Next.js validates early for UX only.

## 2026-10-29 — Reserve at order, deduct at ship
`reserved` grows at placement, `on_hand` drops only at shipping; cancel releases.
Keeps "available" honest while orders are in progress.

## 2026-10-29 — Invite-only accounts, role in `profiles`
No profile = no access. Role never read from JWT `user_metadata` (user-editable).

## 2026-10-29 — Credit limit checked at approval, not placement
Buyers can always submit; a manager approves against `credit_limit` and `outstanding`.

## 2026-10-29 — Tests on real Postgres with an auth shim
Real parallel transactions prove locking. Limitation: PostgREST/GoTrue not exercised.
