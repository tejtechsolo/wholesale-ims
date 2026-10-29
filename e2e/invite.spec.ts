// Invite-only onboarding end to end: script → email → set password → role-based app,
// then admin disable/enable and the forgot-password flow for that same user.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { login } from "./fixtures";
import { confirmLinkFor } from "./mail";

test.describe.configure({ mode: "serial" });

const email = `new-hire-${Date.now()}@test.local`;
const firstPassword = "First-pass-2026";
const resetPassword = "Reset-pass-2026";
const env = { ...process.env, SITE_URL: "http://localhost:3000" };
let inviteSentAt = 0;

function invite(args: string[]) {
  return execFileSync("node", ["scripts/invite-user.mjs", ...args], { env, encoding: "utf8" });
}

async function signIn(page: import("@playwright/test").Page, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("invite script validates input before touching Supabase", () => {
  let err: any;
  try { invite(["--email", "x@test.local", "--role", "customer", "--name", "No Account"]); } catch (e) { err = e; }
  expect(err?.status).toBe(2);
  expect(String(err?.stderr)).toMatch(/--customer <uuid> is required/);
});

test("admin invites a warehouse user by email", async () => {
  const started = Date.now();
  const out = JSON.parse(invite(["--email", email, "--role", "warehouse", "--name", "New Hire"]));
  expect(out).toMatchObject({ ok: true, role: "warehouse", invited: true });
  inviteSentAt = started - 1000;
});

test("invitee follows the email link, sets a password and lands in a warehouse view", async ({ page }) => {
  const link = await confirmLinkFor(email, /invited/i, inviteSentAt);
  await page.goto(link);
  await expect(page).toHaveURL(/\/account\/password\?welcome=1/);
  await expect(page.getByRole("heading", { name: "Welcome, New Hire" })).toBeVisible();
  // Too short: the browser blocks submission (minLength) before the server is involved.
  await page.getByLabel("New password").fill("short1");
  await page.getByLabel("Confirm password").fill("short1");
  await page.getByRole("button", { name: "Save password" }).click();
  expect(await page.getByLabel("New password").evaluate((el: HTMLInputElement) => el.validity.tooShort)).toBe(true);
  await expect(page).toHaveURL(/\/account\/password/);
  // Server-side validation: mismatch is only caught by the server action.
  await page.getByLabel("New password").fill(firstPassword);
  await page.getByLabel("Confirm password").fill(firstPassword + "x");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.locator("form [role=alert]")).toHaveText("Passwords don't match");
  await page.getByLabel("New password").fill(firstPassword);
  await page.getByLabel("Confirm password").fill(firstPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/orders/);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Inventory" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Catalog" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("a used invite link cannot be replayed", async ({ page }) => {
  const link = await confirmLinkFor(email, /invited/i, inviteSentAt);
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/login\?error=expired_link/);
  await expect(page.getByRole("alert")).toContainText("expired or was already used");
});

test("admin disables the user (access ends), then re-enables", async ({ page, browser }) => {
  await login(page, "admin");
  await page.goto("/admin/users");
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("warehouse");
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row).toContainText("Disabled");

  const other = await browser.newPage();
  await signIn(other, firstPassword);
  await expect(other).toHaveURL(/\/login/);
  await other.goto("/inventory");
  await expect(other).toHaveURL(/\/login/);

  await row.getByRole("button", { name: "Enable" }).click();
  await expect(row).toContainText("Active");
  await signIn(other, firstPassword);
  await expect(other).toHaveURL(/\/orders/);
  await other.close();
});

test("forgot password: same answer for unknown emails, reset link works once", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.getByLabel("Email").fill("nobody-here@test.local");
  await page.getByRole("button", { name: "Send reset link" }).click();
  const generic = "If an account exists for that email, a reset link is on its way.";
  await expect(page.getByRole("status")).toHaveText(generic);

  const started = Date.now() - 1000;
  await page.goto("/login/forgot");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(generic);

  const link = await confirmLinkFor(email, /reset/i, started);
  await page.goto(link);
  await expect(page).toHaveURL(/\/account\/password$/);
  await page.getByLabel("New password").fill(resetPassword);
  await page.getByLabel("Confirm password").fill(resetPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/orders/);

  await signIn(page, firstPassword);
  await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
  await signIn(page, resetPassword);
  await expect(page).toHaveURL(/\/orders/);
});

test("a tampered confirm link is rejected", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=deadbeef&type=invite");
  await expect(page).toHaveURL(/\/login\?error=expired_link/);
  await page.goto("/auth/confirm?token_hash=x&type=signup");
  await expect(page).toHaveURL(/\/login\?error=invalid_link/);
});

