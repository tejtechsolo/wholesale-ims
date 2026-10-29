// Order → ship → invoice → payment, through the UI, with each role doing its part.
import { expect, test, type Page } from "@playwright/test";
import { login, watchProblems } from "./fixtures";

test.describe.configure({ mode: "serial" });

let orderNumber = "";

async function advance(page: Page, url: string, button: string, status: string) {
  await page.goto(url);
  await page.getByRole("button", { name: button }).click();
  await expect(page.locator("h1 .badge")).toHaveText(status);
}

test("buyer B orders, manager approves, warehouse ships", async ({ page }) => {
  await login(page, "buyerB");
  await page.goto("/catalog");
  await page.getByLabel("Quantity for OIL-15L").fill("1");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const url = page.url();
  orderNumber = (await page.locator("h1").innerText()).split(" ")[0];

  await login(page, "manager");
  await advance(page, url, "Approve", "approved");
  await login(page, "warehouse");
  await advance(page, url, "Start picking", "picking");
  await advance(page, url, "Mark shipped", "shipped");
  // Warehouse staff have no invoices view.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Invoices" })).toHaveCount(0);
});

test("shipping issued an open invoice; manager records payment", async ({ page }) => {
  const problems = watchProblems(page);
  await login(page, "manager");
  await page.goto("/invoices?status=open");
  const row = page.getByRole("row").filter({ hasText: orderNumber });
  await expect(row).toContainText("Ajmer Wholesale Mart");
  await expect(row).toContainText("₹2,100.00");
  await expect(row.locator('td[data-label="Status"]')).toHaveText("open");

  const form = page.getByRole("form", { name: "Record payment" });
  const customer = form.getByLabel("Customer");
  const value = await customer.locator("option", { hasText: "Ajmer Wholesale Mart" }).getAttribute("value");
  await customer.selectOption(value!);
  await form.getByLabel("Amount (₹)").fill("999999");
  await form.getByRole("button", { name: "Record payment" }).click();
  await expect(form.getByRole("status")).toContainText("more than the amount due");

  await form.getByLabel("Amount (₹)").fill("2100");
  await form.getByLabel("Method").selectOption("upi");
  await form.getByLabel("Reference (UTR / cheque no.)").fill("UTR-E2E-1");
  await form.getByRole("button", { name: "Record payment" }).click();
  await expect(form.getByRole("status")).toHaveText("Payment recorded.");
  await page.goto("/invoices?status=paid");
  await expect(page.getByRole("row").filter({ hasText: orderNumber }).locator('td[data-label="Status"]')).toHaveText("paid");
  expect(problems).toEqual([]);
});

test("buyers see only their own invoices; payment form is staff-only", async ({ page }) => {
  await login(page, "buyerB");
  await page.goto("/invoices");
  await expect(page.getByRole("row").filter({ hasText: orderNumber })).toContainText("paid");
  await expect(page.getByRole("form", { name: "Record payment" })).toHaveCount(0);
  await login(page, "buyerA");
  await page.goto("/invoices");
  await expect(page.getByRole("row").filter({ hasText: orderNumber })).toHaveCount(0);
  await expect(page.getByText("Ajmer Wholesale Mart")).toHaveCount(0);
});
