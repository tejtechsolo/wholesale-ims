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
| UI | Catalog/cart, orders, order detail, inventory | `src/app/(app)/*` |
| DB | Schema, functions, RLS | `supabase/migrations/000{1,2,3}` |

## 2. Database schema (`0001_schema.sql`)

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

`available = on_hand − reserved`. Orders **reserve** at placement; `on_hand` drops only at **ship**.

## 3. Authentication

- Supabase Auth email/password; **invite-only** (disable public sign-ups in the dashboard).
  A user with no `profiles` row has no role → sees nothing, can do nothing (tested).
- Server code uses `auth.getClaims()` (verifies JWT signature), never `getSession()`.
- Role is read from `public.profiles`, **never** from `user_metadata` (user-editable).
- `proxy.ts` is optimistic only; every page calls `requireRole()`, every action calls `guard()`,
  and the DB checks again. Deactivating a profile revokes access on the next request (tested).
- Login: uniform error message (no account enumeration), `next` param restricted to
  same-site paths (no open redirect).

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
| Edit products / customers | ✓ | ✓ | – | – | – |
| Change user roles | ✓ (not self) | – | – | – | – |

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

- [x] RLS enabled on every table; default deny; `anon` gets nothing (tested).
- [x] No client INSERT/UPDATE/DELETE on inventory/orders/items/ledger (tested for all roles).
- [x] Column-level grant: `customers.outstanding` writable only by functions (tested).
- [x] SECURITY DEFINER functions use `set search_path = ''` and schema-qualified names.
- [x] `EXECUTE` revoked from `public`/`anon`; granted only to `authenticated`.
- [x] Ledger + status history immutable via triggers (even for the table owner).
- [x] Server prices, server-side role, idempotent orders, no raw DB errors to clients.
- [x] Security headers + CSP, `poweredByHeader: false`.
- [ ] To do before production: turn off public sign-ups; MFA for admin/manager; Supabase
      auth rate limits + CAPTCHA on login; tighten CSP with nonces (drop `'unsafe-inline'`);
      keep `SUPABASE_SECRET_KEY` only in an admin invite script; PITR backups; run
      Supabase's Security Advisor.

## 9. Automated tests — what was actually run

Run on 2026‑10‑29 in this session:

| Check | Result |
|---|---|
| `vitest run` — 5 files, **59 tests** | **59 passed**, and 10/10 repeated runs green |
| Mutation check: removed `FOR UPDATE` from `place_order` | Oversell test **failed** as intended (the `reserved ≤ on_hand` CHECK blocked overselling but surfaced a raw constraint error) |
| `tsc --noEmit` | passed |
| `next build` (dummy Supabase env) | passed — 7 routes + Proxy |
| `next start` smoke | signed-out `/orders` → 307 to `/login?next=%2Forders`; `/login` 200 with CSP/HSTS/X-Frame headers |

Test files: `tests/db/stock-validation`, `order-workflow`, `security-rls`, `concurrency`
(real parallel transactions on 20+ connections), `tests/unit/domain-errors`.

**Honest limits of what was tested**
- DB tests ran on **local PostgreSQL 16.15** with an emulated `auth.uid()`
  (`tests/helpers/auth-shim.sql`), not a real Supabase project. Supabase's PostgREST layer,
  real JWTs and its Postgres version (15/17) were **not** exercised.
- The Next.js pages and Server Actions were type-checked and built, but **never run against
  a live Supabase** — no real sign-in, catalog load or order placement through the UI.
- No browser/E2E tests, no mobile-viewport visual check, no accessibility audit.
- `.github/workflows/ci.yml` was written but not executed.

## 10. Reviewable stages

| Stage | Scope | Status |
|---|---|---|
| 1 | Schema + constraints (`0001`) | Done, covered by tests |
| 2 | Stock + order functions (`0002`) | Done, covered by tests |
| 3 | Grants + RLS (`0003`) | Done, covered by tests |
| 4 | Domain/validation/error mapping (`src/lib`) | Done, unit + parity tests |
| 5 | Next.js auth, proxy, actions, responsive UI | Written, builds; **not run against Supabase** |
| 6 | E2E (Playwright) on `supabase start`: login per role, place→ship flow, 375px viewport | **Not started** |
| 7 | Hardening: invite script, MFA, rate limits, CSP nonces, low-stock alerts, invoices/payments | **Not started** |

## Running locally

```bash
npm install
# Option A — tests only: any Postgres 15+ superuser URL
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
# Option B — full app: supabase start; supabase db reset (applies migrations);
# load supabase/seed.test.sql (minus the auth.users insert — use real invited users),
# copy .env.example → .env.local, npm run dev
```
