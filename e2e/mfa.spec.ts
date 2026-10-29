// Sign-in challenge for MFA roles (enrolment is in mfa.setup.ts).
import { expect, test } from "@playwright/test";
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
