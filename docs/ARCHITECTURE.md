# Wholesale IMS — Architecture & Review Stages

Next.js 16 (App Router) + Supabase (Postgres, Auth, RLS). Responsive B2B web app for a
wholesaler: buyers order from a catalog, staff approve, pick, ship and manage stock.

## 1. Architecture

```
Browser (React client components: cart, order buttons, stock forms)
   │  Server Actions (POST, same-origin)          │ page requests
   ▼                                              ▼
Next.js server ── proxy.ts: refresh session cookie, optimistic redirect to /login
   │  src/app/actions/*  → guard(role) → zod parse → ONE supabase.rpc() → Result<T>
   │  Server Components  → supabase.from().select()  (RLS-filtered reads)
   ▼  user's JWT (publishable key; never the secret key in app code)
Supabase PostgREST → Postgres
   ├─ RLS policies: who can READ which rows
   ├─ SECURITY DEFINER functions: the ONLY way to WRITE stock / orders
   ├─ CHECK constraints: last line of defence (reserved ≤ on_hand, on_hand ≥ 0)
   └─ append-only ledger (stock_movements) + order_status_history
```

**Key decision — business rules live in Postgres, not in Next.js.** Stock validation must
happen under a row lock inside the same transaction that reserves stock; anything checked
in JavaScript first is already stale. The TypeScript layer validates early for UX
(`checkLine`, zod) but the database is authoritative. A test enforces that the TS
transition table and the SQL state machine stay identical.

| Layer | Responsibility | Files |
|---|---|---|
| Proxy | Session refresh, redirect signed-out users | `src/proxy.ts` |
| Auth helpers | Verified user (`getClaims`) + role from `profiles` | `src/lib/auth.ts` |
| Domain | Roles, statuses, transitions, zod schemas | `src/lib/domain.ts` |
| Errors | DB error → safe user message + status | `src/lib/errors.ts` |
| Actions | Auth guard, validation, RPC call, revalidate | `src/app/actions/*` |
| Throttle / CSP | Sign-in throttle keys, CSP builder | `src/lib/throttle.ts`, `src/lib/csp.ts` |
| UI | Catalog/cart, orders, inventory, invoices, admin console, account (password, MFA) | `src/app/(app)/*` |
| Auth routes | Email link landing (`verifyOtp`), login, forgot password | `src/app/auth/confirm`, `src/app/login` |
| DB | Schema, functions, RLS (0001–0008) | `supabase/migrations/` |
| Scripts | Invite user, reset MFA (secret key; trusted machine only) | `scripts/` |

## 2. Database schema

| Table | Purpose / key constraints |
|---|---|
| `customers` | B2B accounts; GSTIN format check; `credit_limit`, `outstanding ≥ 0` |
| `profiles` | 1:1 with `auth.users`; `role`, `customer_id` (required iff role = customer), `active` |
| `warehouses` | Code + name |
| `products` | SKU (unique, pattern), `unit_price > 0`, `min_order_qty`, `pack_size` |
| `inventory` | PK (product, warehouse); `on_hand ≥ 0`, `reserved ≥ 0`, **`reserved ≤ on_hand`** |
| `orders` | Status enum, total, `unique(created_by, idempotency_key)` |
| `order_items` | Qty > 0, unit_price snapshot from products at order time |
| `stock_movements` | Append-only ledger: receive / adjust / reserve / release / ship |
| `order_status_history` | Append-only audit of every transition with actor |
| `invoices` (0005) | One per shipped order; `amount_paid ≤ amount`; status `open`/`paid` matches balance |
| `payments`, `payment_allocations` (0005) | Append-only; FIFO allocation to open invoices |
| `login_failures` (0007) | Opaque HMAC keys → failure count + window; no API access at all |

`available = on_hand − reserved`. Orders **reserve** at placement; `on_hand` drops only at **ship**.

## 3. Authentication

- Supabase Auth email/password, **invite-only**: public sign-up is off (E2E asserts the
  signup endpoint refuses). Accounts come from `scripts/invite-user.mjs`, which creates the
  auth user + profile with the secret key and rolls the user back if the profile fails.
  A user with no `profiles` row has no role → sees nothing, can do nothing (tested).
- Invite and reset emails link to `/auth/confirm?token_hash=…&type=invite|recovery`
  (`supabase/templates`). `verifyOtp` runs on the server, sets the session cookie, then the
  user picks a password at `/account/password`. Links are single-use (E2E: replay rejected).
- Forgot password answers identically whether or not the account exists.
- Server code uses `auth.getClaims()` (verifies JWT signature), never `getSession()`.
- Role is read from `public.profiles`, **never** from `user_metadata` (user-editable).
- **MFA (TOTP) is mandatory for admin and manager.** `current_app_role()` (0008) returns
  NULL for those roles below `aal2`, so every RLS policy and business function denies them.
  Login sends them to `/account/mfa` (enrol with QR/secret, or enter a code) and keeps the
  deep link. Lost authenticator: `scripts/reset-mfa.mjs` removes the factor; they enrol again.
- **Sign-in throttling** (0007): failures are counted per HMAC(client IP + email) (limit 5)
  and per HMAC(client IP) (limit 30) in a 15-minute window, with a server-only pepper
  `LOGIN_THROTTLE_SECRET`; success clears the pair. Needed because sign-in runs on the Next
  server, so Supabase Auth sees one IP for everyone. Fails open (logged) if unavailable.
- `proxy.ts` is optimistic only; every page calls `requireRole()` (role + MFA), every action
  calls `guard()`, and the DB checks again. Deactivating a profile revokes access on the
  next request (tested). `next` params are restricted to same-site paths (no open redirect).

## 4. Role-based permissions

| Capability | admin | manager | warehouse | sales | customer |
|---|:-:|:-:|:-:|:-:|:-:|
| View catalog availability | ✓ | ✓ | ✓ | ✓ | ✓ |
| View raw inventory | ✓ | ✓ | ✓ | ✓ | – |
| View stock ledger | ✓ | ✓ | ✓ | – | – |
| Place order | any customer | any | – | any | own account |
| See orders | all | all | all | all | own account |
| Approve | ✓ | ✓ | – | – | – |
| Cancel submitted | ✓ | ✓ | – | ✓ | own |
| Cancel approved/picking | ✓ | ✓ | – | – | – |
| Pick / ship / deliver | ✓ | ✓ | ✓ | – | – |
| Receive stock | ✓ | ✓ | ✓ | – | – |
| Adjust stock (needs reason) | ✓ | ✓ | – | – | – |
| Transfer between warehouses | ✓ | ✓ | ✓ | – | – |
| Set reorder level | ✓ | ✓ | – | – | – |
| Low-stock report | ✓ | ✓ | ✓ | ✓ | – |
| See invoices / payments | all | all | – | all | own account |
| Record payment | ✓ | ✓ | – | – | – |
| Edit products / customers / payment terms | ✓ | ✓ | – | – | – |
| Manage warehouses | ✓ | – | – | – | – |
| Change roles, disable users | ✓ (not self) | – | – | – | – |
| **MFA required** | **yes** | **yes** | no | no | no |

Enforced in three places: UI (hide buttons via `nextActions`), Server Action guard, Postgres.

## 5. Stock validation (`place_order`)

1. Auth + role + "buyer orders only for own account".
2. Idempotency replay: same user + key → return the existing order (also handles the
   parallel race via the unique constraint).
3. Normalise lines (merge duplicates); reject empty, >100 lines, qty ≤ 0.
4. Unknown product → `PRODUCT_NOT_FOUND`; no inventory row → `INSUFFICIENT_STOCK`.
5. **Lock inventory rows `FOR UPDATE` in fixed (product, warehouse) order** — prevents
   overselling and deadlocks.
6. Per line: active product, `≥ min_order_qty`, multiple of `pack_size`, `≤ available`.
7. Price from `products` (client-supplied prices ignored). Insert order + items, bump
   `reserved`, write `reserve` ledger rows and history. All-or-nothing.

### Transfers and reorder levels (`0004_transfers_reorder.sql`)

- `transfer_stock` moves only **free** stock (`on_hand − reserved`) so open orders keep
  their units; destination row is created if missing; both rows locked in the same fixed
  order as `place_order`; two `transfer` ledger rows (−qty / +qty). Inactive destination
  warehouses are rejected.
- `set_reorder_level` (manager/admin) — inventory still has no client UPDATE grant.
- `low_stock_report()` lists active products where **available ≤ reorder_level**
  (level 0 = alert off), worst shortfall first. Reservations count, so a big order can put
  a product on the report and cancelling takes it off (tested). Shown on `/inventory`.

## 6. Order workflow

```
submitted ──approve──▶ approved ──pick──▶ picking ──ship──▶ shipped ──deliver──▶ delivered
    │                     │                  │
    └──── cancel ─────────┴──── cancel ──────┘   (cancel releases reservations)
```

- **approve**: credit check `outstanding + total ≤ credit_limit`, then `outstanding += total`.
- **cancel**: release reserved stock; if approved/picking, reverse `outstanding`.
- **ship**: `on_hand −= qty`, `reserved −= qty`, `ship` ledger rows.
- Order row locked `FOR UPDATE`, so two managers racing resolve deterministically (tested).
- Another customer's order → `ORDER_NOT_FOUND` (does not reveal existence).

## 7. Error handling

- DB raises `P0001` with MESSAGE = stable code (`INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`, …)
  and DETAIL = JSON (`{sku, available, requested}`).
- `toAppError()` maps codes → user-safe message + HTTP-like status; Postgres errors
  `42501/23505/23514` map to FORBIDDEN/CONFLICT/VALIDATION; anything else becomes a generic
  `INTERNAL` (raw message logged server-side only, never sent to the browser).
- Actions return `Result<T>` (`{ok:true,data}` / `{ok:false,error}`) — no thrown errors cross
  the network. Reads that fail throw to `(app)/error.tsx`.
- Cart keeps one idempotency key per attempt: safe retry on network errors; new key after a
  business rejection; `router.refresh()` to show fresh availability.

## 8. Security requirements (checklist)

- [x] RLS enabled on every table; default deny (audited by `privilege-audit.test.ts`).
- [x] `anon` can execute exactly one function, `login_throttle`; nothing else (snapshot test).
- [x] No client INSERT/UPDATE/DELETE on inventory/orders/items/ledger/invoices/payments.
- [x] Column-level grants: `customers.outstanding` writable only by functions (tested).
- [x] SECURITY DEFINER functions pin `search_path = ''` (tested for every function).
- [x] Ledger, status history, payments, allocations immutable via triggers.
- [x] Server prices, server-side role, idempotent orders and payments, no raw DB errors.
- [x] Per-request CSP nonce, no `'unsafe-inline'` scripts; HSTS, X-Frame-Options, etc.
- [x] Invite-only accounts; single-use email links verified server-side.
- [x] Mandatory TOTP MFA for admin/manager, enforced in the database.
- [x] Sign-in throttling per client IP + email and per IP.
- [ ] Hosted project: see §11 before going live (templates, pepper, proxy, backups).
- [ ] Not built: CAPTCHA (Supabase supports hCaptcha/Turnstile via dashboard + a widget),
      audit log for catalog/customer edits, GST/tax lines, credit notes, refunds.

## 9. Automated tests — what was actually run

Local (agent session, PostgreSQL 16 + auth shim) and CI, 2026‑10‑30 on `feat/auth-hardening` (PR #7):

| Check | Result |
|---|---|
| `vitest run` — 17 files | **157 passed** locally and in CI (DB, RLS, concurrency, privilege audit, unit) |
| Playwright E2E (CI, real local Supabase stack) | **39 passed** (desktop + 375px mobile, incl. MFA setup project) |
| `tsc --noEmit`, `next build` | passed |
| Mutation checks | Fail as intended when removed: `place_order` row lock, transfer lock / reserved check, payment locks, atomic throttle counter, per-request nonce |

CI (GitHub Actions): `test` job (vitest + build + CSP smoke) and `e2e` job (Playwright,
desktop + 375px mobile, against `supabase start` with Mailpit). Pass counts are published as
`::notice` annotations (`playwright summary`, `vitest summary`) on every run. E2E covers:
login/redirects, enumeration-safe errors, sign-up disabled, throttling, invite → set password,
link replay, disable/enable, forgot password, MFA enrolment + challenge + reset, place →
approve → pick → ship, order-to-cash, admin console, permissions per role, mobile layout.

**Honest limits**
- Nothing has run against a hosted Supabase project or a real email provider.
- DB unit tests use an auth shim; E2E uses the real local Supabase stack (Postgres 17).
- No accessibility audit, load test or visual regression.

## 10. Reviewable stages

| Stage | Scope | Status |
|---|---|---|
| 1–4 | Schema, functions, RLS, domain/validation | Done |
| 5 | Next.js auth, proxy, actions, responsive UI | Done, E2E-tested |
| 6 | Playwright E2E on `supabase start` in CI | Done |
| 7a | Transfers, reorder levels, low-stock report | Done |
| 7b | CSP nonces | Done |
| 7c-1 | Invoices at shipping, payments, payment terms | Done, E2E-tested |
| 7c-2 | Invite flow, password reset, admin console | Done, E2E-tested |
| 7c-3 | Sign-in throttling, mandatory MFA for admin/manager | Done (PR #7) |

## 11. Hosted rollout checklist

1. Create the project; run migrations (`supabase db push`). Do **not** load `seed.test.sql`.
2. Auth → Providers: email on, **sign-ups off**. Auth → MFA: TOTP enrol + verify on.
3. Auth → Email Templates: paste `supabase/templates/invite.html` and `recovery.html`
   (links must go to `/auth/confirm`); set Site URL to the app URL.
4. Configure SMTP (the built-in sender is for testing only).
5. App env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `LOGIN_THROTTLE_SECRET` (`openssl rand -hex 32`). Never put the secret key in the app.
6. Host behind a proxy that sets `X-Forwarded-For` (e.g. Vercel); otherwise throttling sees
   every client as one IP.
7. First admin: `scripts/invite-user.mjs --role admin` from a trusted machine; they set a
   password, then enrol MFA at first sign-in.
8. Enable PITR/backups; run Supabase's Security Advisor; consider CAPTCHA on sign-in.

## Running locally

```bash
npm install
# Unit + DB tests: any Postgres 15+ superuser URL
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
# Full app + E2E (needs Docker): supabase start; export the env from `supabase status -o env`
# (see .github/workflows/ci.yml), npm run build, npx playwright test
```
