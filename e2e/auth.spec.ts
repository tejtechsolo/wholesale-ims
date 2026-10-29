import { expect, test } from "@playwright/test";
import { USERS, login, watchProblems } from "./fixtures";

test("signed-out users are sent to login and back after signing in", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/login\?next=%2Finventory/);
  await page.getByLabel("Email").fill(USERS.warehouse.email); // non-MFA role: MFA has its own spec
  await page.getByLabel("Password").fill("E2e-Pass-2026!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("wrong password shows a generic error (no account enumeration)", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.buyerA.email);
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
  await page.getByLabel("Email").fill("nobody@test.local");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password.");
});

test("a user without a profile cannot get into the app", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.pending.email);
  await page.getByLabel("Password").fill("E2e-Pass-2026!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("sign out ends the session", async ({ page }) => {
  await login(page, "buyerA");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login/);
});

test("public sign-up is disabled (accounts are invite-only)", async ({ request }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await request.post(`${url}/auth/v1/signup`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "Content-Type": "application/json" },
    data: { email: `intruder-${Date.now()}@test.local`, password: "Some-Pass-2026!" },
  });
  expect(res.status()).toBe(422);
  expect(await res.text()).toMatch(/signup_disabled|Signups not allowed/i);
});

test("repeated wrong passwords lock that email from this client for a while", async ({ page }) => {
  // The pending user is only used to prove "no profile = no access", so locking it is harmless.
  const attempt = async (label: string, email: string, password: string, expected: string | RegExp) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      if (expected instanceof RegExp) await expect(page).toHaveURL(expected);
      else await expect(page.locator("form [role=alert]")).toHaveText(expected);
    } catch (e) {
      const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
      throw new Error(`${label}: url=${page.url()} body="${body}"\n${(e as Error).message.split("\n")[0]}`);
    }
  };
  for (let i = 0; i < 5; i++)
    await attempt(`wrong #${i + 1}`, USERS.pending.email, `wrong-${i}`, "Invalid email or password.");
  // Even the right password is refused now.
  await attempt("locked", USERS.pending.email, "E2e-Pass-2026!", "Too many failed sign-in attempts. Try again in 15 minutes.");
  // Other accounts from the same client are unaffected.
  await attempt("other account", USERS.buyerA.email, "E2e-Pass-2026!", /\/orders/);
});
