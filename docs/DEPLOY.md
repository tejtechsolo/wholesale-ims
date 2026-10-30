# Deploy: Supabase + Vercel (step by step)

The app needs a Supabase project. Deploying only the repo to Vercel is not enough: the login
page will say "this site isn't connected to its database" until steps 1–4 are done.
Test accounts like `admin@test.local` exist **only** in the local/CI stack, never here.

## 1. Create the Supabase project
supabase.com → New project (region close to your users, e.g. Mumbai). Save the DB password.

## 2. Create the database (run the migrations)
SQL Editor → New query → paste and **Run** each file from `supabase/migrations/`,
**in order**, one at a time: `0001_schema.sql`, `0002_functions.sql`, … `0008_mfa_staff.sql`.
(With the Supabase CLI instead: `supabase link --project-ref <ref>` then `supabase db push`.)
Optional sample data: run `supabase/demo-data.sql` (customers, warehouses, products, stock).
Never run `supabase/seed.test.sql` on a hosted project.

## 3. Auth settings (Dashboard → Authentication)
- Sign In / Providers → Email: **enabled**; "Allow new users to sign up": **off**.
- Multi-Factor: TOTP enabled (admins and managers are required to use it).
- URL Configuration → Site URL: `https://wholesale-ims.vercel.app` (your Vercel URL).
- Email Templates: paste `supabase/templates/invite.html` into "Invite user" and
  `supabase/templates/recovery.html` into "Reset password" (links must go to `/auth/confirm`).
- For real use, set up custom SMTP (the built-in sender is rate-limited and for testing).

## 4. Vercel environment variables (Project → Settings → Environment Variables)
| Name | Value (from Supabase → Project Settings → API / API Keys) |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL, e.g. `https://abcdxyz.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) or the legacy anon key |
| `LOGIN_THROTTLE_SECRET` | Any long random string, e.g. output of `openssl rand -hex 32` |

Then **Deployments → Redeploy** (the `NEXT_PUBLIC_*` values are baked in at build time).
Never add the secret / service-role key to Vercel: only `scripts/` use it, from your machine.

## 5. First admin
Either
- **Dashboard (no tools needed):** Authentication → Users → Add user → email + password,
  tick "Auto Confirm User". Then edit the email/name in `supabase/first-admin.sql` and run
  it in the SQL Editor.
- **Script:** `node --env-file=.env.local scripts/invite-user.mjs --email you@x.com --role admin --name "You"`
  (needs `SUPABASE_SECRET_KEY` and `SITE_URL` in `.env.local`; sends an invite email).

Sign in at `/login`. As an admin you'll be asked to scan a QR code with an authenticator app
(Google Authenticator, Microsoft Authenticator, 1Password…) and enter its 6-digit code.
Then create other users the same way, or with the invite script, and set roles in Admin → Users.

## If sign-in still fails
- "isn't connected to its database" → step 4 env vars missing / placeholder; redeploy after fixing.
- "temporarily unavailable" → Supabase URL wrong or project paused (free projects pause when idle).
- "Invalid email or password" → the user doesn't exist in *this* project, or wrong password.
- Signed in but bounced back to `/login` → the user has no row in `profiles` (step 5).
