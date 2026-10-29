import { expect, test, type Page } from "@playwright/test";
import { login, watchProblems } from "./fixtures";

async function noHorizontalScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll, "page wider than the viewport").toBeLessThanOrEqual(width);
}

test("375px: login, catalog and orders fit the screen", async ({ page }) => {
  const problems = watchProblems(page);
  await page.goto("/login");
  await noHorizontalScroll(page);
  await login(page, "buyerA");
  await noHorizontalScroll(page);
  await page.goto("/catalog");
  await expect(page.getByLabel("Quantity for OIL-15L")).toBeVisible();
  await noHorizontalScroll(page);
  expect(problems).toEqual([]);
});

test("375px: tables collapse into labelled cards", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/inventory");
  await expect(page.locator("table.responsive thead")).toBeHidden();
  await expect(page.locator('td[data-label="On hand"]').first()).toBeVisible();
  await noHorizontalScroll(page);
});
