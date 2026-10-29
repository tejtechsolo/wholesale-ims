// Admin console: who can reach it, and a new product going from creation to the buyer's catalog.
import { expect, test } from "@playwright/test";
import { login, watchProblems } from "./fixtures";

test.describe.configure({ mode: "serial" });

const sku = `E2E-TEA-${Date.now().toString(36).toUpperCase()}`;

test("access: sales and buyers can't open admin; managers can't manage users or warehouses", async ({ page }) => {
  for (const who of ["sales", "buyerA"] as const) {
    await login(page, who);
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" })).toHaveCount(0);
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/orders\?denied=1/);
  }
  await login(page, "manager");
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: /Products/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Users/ })).toHaveCount(0);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/orders\?denied=1/);
});

test("manager creates a product; duplicates and bad input are rejected", async ({ page }) => {
  const problems = watchProblems(page);
  await login(page, "manager");
  await page.goto("/admin/products");
  const form = page.locator(".card").filter({ has: page.getByRole("heading", { name: "New product" }) });
  await form.getByLabel("SKU").fill(sku.toLowerCase());
  await form.getByLabel("Name").fill("Assam Tea 1kg");
  await form.getByLabel("Unit").fill("pack");
  await form.getByLabel("Price (₹)").fill("0");
  await form.getByRole("button", { name: "Add product" }).click();
  await expect(form.getByRole("alert")).toBeVisible();

  await form.getByLabel("Price (₹)").fill("450");
  await form.getByLabel("Min qty").fill("2");
  await form.getByLabel("Pack size").fill("2");
  await form.getByRole("button", { name: "Add product" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("article", { name: `Product ${sku}` })).toBeVisible();

  await form.getByLabel("SKU").fill(sku);
  await form.getByLabel("Name").fill("Duplicate");
  await form.getByLabel("Price (₹)").fill("1");
  await form.getByRole("button", { name: "Add product" }).click();
  await expect(form.getByRole("alert")).toHaveText(`SKU ${sku} already exists.`);
  expect(problems).toEqual([]);
});

test("warehouse receives the new product; buyer can now order it", async ({ page }) => {
  await login(page, "warehouse");
  await page.goto("/inventory");
  const receive = page.getByRole("form", { name: "Receive stock" });
  const value = await receive.getByLabel("Product").locator("option", { hasText: sku }).getAttribute("value");
  await receive.getByLabel("Product").selectOption(value!);
  await receive.getByLabel("Quantity").fill("20");
  await receive.getByLabel("PO / note").fill("PO-E2E");
  await receive.getByRole("button", { name: "Receive" }).click();
  await expect(receive.getByRole("status")).toHaveText("Received. On hand: 20");

  await login(page, "buyerA");
  await page.goto("/catalog");
  const card = page.getByRole("article").filter({ hasText: sku });
  await expect(card).toContainText("20 available");
  await expect(card).toContainText("Min 2 · packs of 2");
});

test("manager deactivates the product; it disappears from the catalog", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/admin/products");
  const row = page.getByRole("article", { name: `Product ${sku}` });
  await row.getByLabel("Active").uncheck();
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row.getByRole("status")).toHaveText("Saved");
  await login(page, "buyerA");
  await page.goto("/catalog");
  await expect(page.getByRole("article").filter({ hasText: sku })).toHaveCount(0);
});

test("manager updates a customer's credit limit and payment terms", async ({ page }) => {
  await login(page, "manager");
  await page.goto("/admin/customers");
  const card = page.getByRole("article", { name: "Customer Ajmer Wholesale Mart" });
  await card.getByLabel("Payment terms (days)").fill("45");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("status")).toHaveText("Saved");
  await card.getByLabel("GSTIN").fill("BAD");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("alert")).toHaveText("GSTIN must be 15 characters");
  await page.reload();
  await expect(page.getByRole("article", { name: "Customer Ajmer Wholesale Mart" }).getByLabel("Payment terms (days)"))
    .toHaveValue("45");
});

test("admin adds a warehouse; it becomes a receiving option", async ({ page }) => {
  const code = `E2E-${Date.now().toString(36).slice(-5).toUpperCase()}`;
  await login(page, "admin");
  await page.goto("/admin/warehouses");
  const form = page.locator(".card").filter({ has: page.getByRole("heading", { name: "New warehouse" }) });
  await form.getByLabel("Code").fill(code);
  await form.getByLabel("Name").fill("E2E Depot");
  await form.getByRole("button", { name: "Add warehouse" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved");
  await page.goto("/inventory");
  await expect(page.getByRole("form", { name: "Receive stock" }).getByLabel("Warehouse").locator("option", { hasText: code }))
    .toHaveCount(1);
});
