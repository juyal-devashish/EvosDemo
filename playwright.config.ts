import { defineConfig, devices } from "@playwright/test";

// Set E2E_BASE_URL to test a deployed site (no local dev server), with
// NEXT_PUBLIC_CONVEX_URL pointing at that site's Convex deployment.
const remote = process.env.E2E_BASE_URL;

// E2E suite (SPEC §13). The "setup" project fetches a Clerk testing token;
// signed-in specs depend on it. Specs under tests/e2e/tasks change state
// and only run when named explicitly.
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: process.env.E2E_TASKS ? [] : ["tasks/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: remote ?? "http://localhost:3000", trace: "on-first-retry" },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: remote
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
      },
});
