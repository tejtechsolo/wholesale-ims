// Runs before all specs: admin and manager sign in with a password, are sent to MFA setup,
// enrol TOTP through the real UI, and their verified (aal2) sessions are saved for reuse.
import { expect, test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PASSWORD, USERS } from "./fixtures";
import { AUTH_DIR, MFA_USERS, freshCode, saveSecret, storageFile } from "./totp";

mkdirSync(AUTH_DIR, { recursive: true });

for (const who of MFA_USERS) {
  setup(`${who} enrols TOTP via the UI`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USERS[who].email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account\/mfa\?next=%2Forders/);
    // Until MFA is done the app shows no navigation and the DB grants no role.
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(0);
    await page.goto("/inventory");
    await expect(page).toHaveURL(/\/account\/mfa/);

    await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();
    const secret = (await page.getByLabel("Secret key").innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    saveSecret(who, secret);

    await page.getByLabel("Authentication code").fill("000000");
    await page.getByRole("button", { name: "Turn on two-factor" }).click();
    await expect(page.locator("form [role=alert]")).toHaveText("That code didn't work. Wait for a new code and try again.");

    await page.getByLabel("Authentication code").fill(await freshCode(who));
    await page.getByRole("button", { name: "Turn on two-factor" }).click();
    await expect(page).toHaveURL(/\/orders/);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" })).toBeVisible();
    await page.context().storageState({ path: storageFile(who) });
  });
}
