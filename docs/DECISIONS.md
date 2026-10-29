# Decision log

Newest first. One entry per decision: date, decision, why, consequence. Append; don't rewrite.

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
