import { expect, type Page } from "@playwright/test";

export const PASSWORD = "E2e-Pass-2026!";
// Same ids as supabase/seed.test.sql, so profiles/customers line up.
export const USERS = {
  admin: { id: "00000000-0000-4000-8000-000000000001", email: "admin@test.local" },
  manager: { id: "00000000-0000-4000-8000-000000000002", email: "manager@test.local" },
  warehouse: { id: "00000000-0000-4000-8000-000000000003", email: "warehouse@test.local" },
  sales: { id: "00000000-0000-4000-8000-000000000004", email: "sales@test.local" },
  buyerA: { id: "00000000-0000-4000-8000-00000000000a", email: "buyer-a@test.local" },
  buyerB: { id: "00000000-0000-4000-8000-00000000000b", email: "buyer-b@test.local" },
  pending: { id: "00000000-0000-4000-8000-0000000000ff", email: "pending@test.local" },
} as const;
export type UserKey = keyof typeof USERS;

export async function login(page: Page, who: UserKey) {
  await page.context().clearCookies();
  const log: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => log.push(`console.${m.type()}: ${m.text()}`);
  const onFail = (r: { url(): string; failure(): { errorText: string } | null }) =>
    log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`);
  const onResp = (r: { url(): string; status(): number; request(): { method(): string } }) => {
    if (r.request().method() === "POST" || r.status() >= 300) log.push(`response: ${r.request().method()} ${r.status()} ${r.url()}`);
  };
  page.on("console", onConsole); page.on("requestfailed", onFail); page.on("response", onResp);
  try {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USERS[who].email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/orders/);
  } catch (e) {
    const alert = await page.locator("form [role=alert]").allInnerTexts().catch(() => []);
    const cookies = (await page.context().cookies()).map((c) => `${c.name}(secure=${c.secure})`);
    throw new Error(`login(${who}) failed at ${page.url()}\nalert: ${JSON.stringify(alert)}\n` +
      `cookies: ${cookies.join(", ") || "none"}\n${log.slice(-15).join("\n")}\n${(e as Error).message.split("\n")[0]}`);
  } finally {
    page.off("console", onConsole); page.off("requestfailed", onFail); page.off("response", onResp);
  }
}

/** Collects CSP violations and page errors; assert it's empty at the end of a test. */
export function watchProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}
