// Sign-in challenge for MFA roles (enrolment is in mfa.setup.ts).
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { TOTP } from "otpauth";
import { PASSWORD, USERS, login } from "./fixtures";
import { freshCode } from "./totp";

test("manager: password alone is not enough; a fresh TOTP code completes sign-in", async ({ browser }) => {
  const context = await browser.newContext(); // brand-new session, no saved cookies
  const page = await context.newPage();
  await page.goto("/admin/products");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fproducts/);
  await page.getByLabel("Email").fill(USERS.manager.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Already enrolled → challenge form only, no QR / secret shown again.
  await expect(page).toHaveURL(/\/account\/mfa\?next=%2Fadmin%2Fproducts/);
  await expect(page.getByAltText("QR code for your authenticator app")).toHaveCount(0);
  await expect(page.getByLabel("Secret key")).toHaveCount(0);

  await page.getByLabel("Authentication code").fill("12345");
  await page.getByRole("button", { name: "Verify" }).click();
  expect(await page.getByLabel("Authentication code").evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);

  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator("form [role=alert]")).toHaveText("That code didn't work. Wait for a new code and try again.");

  await page.getByLabel("Authentication code").fill(await freshCode("manager"));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/admin\/products$/); // deep link preserved through MFA
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await context.close();
});

test("non-MFA roles are never asked for a code and aren't offered two-factor", async ({ page }) => {
  await login(page, "warehouse");
  await expect(page.getByRole("link", { name: "Two-factor" })).toHaveCount(0);
  await page.goto("/account/mfa");
  await expect(page.getByText("Two-factor is used for admin and manager accounts.")).toBeVisible();
});

test("the saved MFA session shows two-factor as on", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/account/mfa");
  await expect(page.getByRole("status")).toHaveText("Two-factor is on and this session is verified.");
});

test("lost authenticator: reset-mfa script removes the factor and the manager must enrol again", async ({ browser }) => {
  const email = `mfa-reset-${Date.now()}@test.local`;
  const password = "Reset-flow-2026";
  const run = (script: string, args: string[]) =>
    JSON.parse(execFileSync("node", [`scripts/${script}`, ...args], { env: process.env, encoding: "utf8" }));
  // --password is accepted only because the Supabase URL is local (CI stack).
  expect(run("invite-user.mjs", ["--email", email, "--role", "manager", "--name", "Temp Manager", "--password", password]))
    .toMatchObject({ ok: true, role: "manager" });

  const signIn = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account\/mfa/);
    return { context, page };
  };

  const first = await signIn();
  const secret = (await first.page.getByLabel("Secret key").innerText()).trim();
  await first.page.getByLabel("Authentication code").fill(new TOTP({ secret }).generate());
  await first.page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(first.page).toHaveURL(/\/orders/);
  await first.context.close();

  expect(run("reset-mfa.mjs", ["--email", email])).toMatchObject({ ok: true, removed: 1 });

  const second = await signIn();
  // Enrolment again (QR + new secret), not a challenge for the deleted factor.
  await expect(second.page.getByAltText("QR code for your authenticator app")).toBeVisible();
  expect((await second.page.getByLabel("Secret key").innerText()).trim()).not.toBe(secret);
  await second.context.close();
});
