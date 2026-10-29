import { defineConfig, devices } from "@playwright/test";

// E2E against a real Supabase stack (`supabase start`) + a production Next build.
// Env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, SUPABASE_DB_URL
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,       // specs share one seeded database
  workers: 1,
  retries: 0,                 // a flaky E2E is a bug to fix, not to retry away
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    // Enrols TOTP for admin + manager once and saves their verified (aal2) sessions.
    { name: "mfa-setup", use: { ...devices["Desktop Chrome"] }, testMatch: /mfa\.setup\.ts/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec|mfa\.setup/, dependencies: ["mfa-setup"] },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 } }, testMatch: /mobile\.spec/, dependencies: ["mfa-setup"] },
  ],
  webServer: {
    command: "npx next start -p 3000",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
