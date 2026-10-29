import { expect, test, type Page } from "@playwright/test";
import { login, watchProblems } from "./fixtures";

test.describe.configure({ mode: "serial" });

let orderUrl = "";
let onHandBefore = 0;

async function oilOnHand(page: Page) {
  await page.goto("/inventory");
  const row = page.getByRole("row").filter({ hasText: "OIL-15L" }).filter({ hasText: "JAI-01" });
  return Number(await row.locator('td[data-label="On hand"]').innerText());
}

test("manager notes current stock", async ({ page }) => {
  await login(page, "manager");
  onHandBefore = await oilOnHand(page);
  expect(onHandBefore).toBeGreaterThanOrEqual(2);
});

test("buyer: client-side checks, then places an order", async ({ page }) => {
  const problems = watchProblems(page);
  await login(page, "buyerA");
  await page.goto("/catalog");
  const rice = page.getByLabel("Quantity for RICE-25KG");
  await rice.fill("3");
  await expect(page.getByText("RICE-25KG: minimum order is 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Place order" })).toBeDisabled();
  await rice.fill("");

  await page.getByLabel("Quantity for OIL-15L").fill("2");
  await expect(page.getByText("Total ₹4,200")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  await expect(page.locator("h1 .badge")).toHaveText("submitted");
  await expect(page.getByText("Total: ₹4,200")).toBeVisible();
  // Buyer may cancel but not approve.
  await expect(page.getByRole("button", { name: "Cancel order" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  orderUrl = page.url();
  expect(problems).toEqual([]);
});

test("another buyer cannot open that order", async ({ page }) => {
  await login(page, "buyerB");
  const res = await page.goto(orderUrl);
  expect(res?.status()).toBe(404);
});

test("manager approves", async ({ page }) => {
  await login(page, "manager");
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("approved");
});

test("warehouse picks and ships; on-hand drops only at shipping", async ({ page }) => {
  await login(page, "warehouse");
  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Start picking" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("picking");
  expect(await oilOnHand(page)).toBe(onHandBefore);

  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Mark shipped" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("shipped");
  expect(await oilOnHand(page)).toBe(onHandBefore - 2);

  await page.goto(orderUrl);
  await page.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("delivered");
  await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
});

test("buyer can cancel a fresh order and the reservation is released", async ({ page }) => {
  await login(page, "buyerA");
  await page.goto("/catalog");
  const card = page.locator("article").filter({ hasText: "OIL-15L" });
  const before = Number((await card.getByText(/available$/).innerText()).split(" ")[0]);
  await page.getByLabel("Quantity for OIL-15L").fill("1");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.locator("h1 .badge")).toHaveText("cancelled");
  await page.goto("/catalog");
  await expect(card.getByText(`${before} available`)).toBeVisible();
});
