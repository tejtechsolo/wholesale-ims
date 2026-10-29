# Wholesale IMS — project memory

Read this first in every session. Update it in the same PR whenever state, commands or
rules change. Design detail lives in `docs/ARCHITECTURE.md`; the decision log in
`docs/DECISIONS.md`.

## What this is
Responsive B2B wholesale inventory + ordering site. Next.js 16 (App Router, `src/proxy.ts`
not middleware) + Supabase (Postgres, Auth, RLS). Owner: tejtechsolo. Repo is **public**:
never commit secrets, real customer data or `.env*` (only `.env.example`).

## Current state (update on every merge)
- `main` @ stages 1–5, 6 (E2E), 7a (transfers / reorder / low-stock), 7b (CSP nonce),
  7c-1 (invoices issued at ship, payments with FIFO allocation, payment terms),
  7c-2 (invite script, invite/reset password flow, admin console: products, customers,
  warehouses, users; receive stock for new products).
- Last verified 2026-10-30: 105/105 vitest, `tsc` clean, `next build` OK, CSP smoke PASS.
- Stage 6 E2E: Playwright (16 tests) against `supabase start` + production build runs in CI
  (`e2e` job); first green run 2026-10-30 (16 passed). Never run against a hosted project.

## Next up (in order)
1. ~~Stage 6 E2E~~ done 2026-10-30 (`e2e/`, CI job `e2e`).
2. Stage 7c-3: MFA (TOTP) for admin/manager, login throttling / CAPTCHA.
3. Not modelled: GST/tax lines, credit notes, refunds, advance payments.
4. ~~Run CI on GitHub~~ done 2026-10-30: fixed role race + 57P01 crash; CI green 3/3 reruns.

## Commands
```bash
npm test                 # vitest: unit + DB tests (needs Postgres, see below)
npm run typecheck        # tsc --noEmit
npm run build            # needs NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY (dummy OK)
npm run test:smoke       # BASE_URL=http://localhost:3000, against `next start`
npx playwright test      # E2E; needs `supabase start` env (see playwright.config.ts) — CI only here
node --env-file=.env.local scripts/invite-user.mjs --email … --role … --name …  # new account
```
DB tests create/drop a throwaway database per file. Set `TEST_DATABASE_URL` to a Postgres
15+ superuser URL (default `postgres://postgres@localhost:54329/postgres`).
`tests/helpers/auth-shim.sql` emulates Supabase `auth.uid()`; it is NOT a migration.

## CI (GitHub Actions)
Job logs live on Azure blob storage, which agent sessions can't reach. Failing test output
is therefore re-emitted as an `::error` annotation. From a session:
`scripts/ci-wait.sh <sha>` (poll), `scripts/ci-annotations.sh <sha>` (read failures),
`scripts/pr.sh <branch> <title> <body.md>` (open PR via REST; GraphQL and the GitHub
connector's PR tools are blocked/403). Merge: `gh api -X PUT repos/…/pulls/N/merge`.

## Rules — do not break these
- **All writes to stock/orders go through SECURITY DEFINER functions** in
  `supabase/migrations`. Clients only SELECT through RLS. Never grant INSERT/UPDATE on
  `inventory`, `orders`, `order_items`, `stock_movements`, `order_status_history`.
- Lock inventory rows `FOR UPDATE` **ordered by (product_id, warehouse_id)** in every
  function that touches more than one row (deadlock rule).
- Functions: `set search_path = ''`, schema-qualify everything, check role via
  `public.has_role()`, fail with `public.fail('CODE', jsonb)`. New codes must be added to
  `src/lib/errors.ts`.
- Role comes from `public.profiles`, never `user_metadata`. Server auth uses `getClaims()`.
- The secret key is used ONLY by `scripts/` (invite). Web app code never imports it.
- Auth emails must link to `/auth/confirm?token_hash=…&type=…` (supabase/templates); hosted
  projects need the same templates pasted in the dashboard, or invites/resets won't work.
- `src/lib/domain.ts` TRANSITIONS must match `public.transition_allowed()` (parity test).
- Ledger, status history, payments and allocations are append-only (triggers). Prices
  always from `products`. Invoices are only written by the ship trigger and record_payment().
- Never edit an applied migration; add `000N_*.sql`.
- Supabase auto-grants new `public` tables/functions to `anon`/`authenticated`. Every
  migration must revoke explicitly and grant the minimum; `tests/db/privilege-audit.test.ts`
  snapshots all API-role privileges and fails on any change (update it deliberately).

## Workflow
- Branch `feat/<topic>` from `main` → tests + typecheck + build (+ smoke if UI/proxy) →
  PR → merge. Commit messages: conventional (`feat(db):`, `test:`, `docs:`).
- New business rule = DB function + DB test (incl. a role/deny case) + TS schema + action.
- Concurrency-sensitive change: add a parallel test and confirm it FAILS without the fix.
- Report honestly: only claim "tested" for what was actually run.

## Gotchas learned
- Supabase CLI: `[auth.email] enable_signup = false` disables the whole email provider
  (password sign-in → 422 email_provider_disabled). Block sign-up with `[auth] enable_signup`.
- Cluster-wide roles must be created once (vitest `globalSetup`), never per test file:
  parallel `CREATE ROLE` races on a fresh cluster (CI only; local roles pre-existed).
- Every `pg.Pool` needs an `error` listener; force-dropping a DB kills closing sockets.
- `pkill -f`/`pgrep -f` in agent shells can match the shell itself; stop servers by port
  (`fuser -k 3000/tcp`).
- FOR UPDATE can't target the nullable side of a LEFT JOIN; check missing rows first.
- Next 16.4 stamped the nonce even without the CSP *request* header; keep it anyway (docs).
- Without the row lock, the `reserved <= on_hand` CHECK still blocks overselling but
  surfaces a raw 23514 error — the lock is what gives clean `INSUFFICIENT_STOCK`.
