import { expect, test } from "@playwright/test";
import { login } from "./fixtures";

test("buyers have no inventory access and see only their own nav", async ({ page }) => {
  await login(page, "buyerA");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Catalog" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Inventory" })).toHaveCount(0);
  await page.goto("/inventory");
  await expect(page).toHaveURL(/\/orders\?denied=1/);
});

test("warehouse staff cannot open the catalog / place orders", async ({ page }) => {
  await login(page, "warehouse");
  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/orders\?denied=1/);
});

test("buyer catalog shows availability but never raw stock fields", async ({ page }) => {
  await login(page, "buyerA");
  await page.goto("/catalog");
  await expect(page.getByText("Mustard Oil 15L")).toBeVisible();
  await expect(page.getByText(/available|Out of stock/).first()).toBeVisible();
  await expect(page.getByText("Discontinued Item")).toHaveCount(0);
  await expect(page.getByText(/on hand|reserved/i)).toHaveCount(0);
});
