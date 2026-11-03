import { expect, test } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { convexUrl } from "./env";

// Public results page. Reads the same Convex query the page uses and checks
// the screen against it (T2). Requires at least one finished suite run in
// the local deployment. No AI calls.

const client = new ConvexHttpClient(convexUrl());

test("T2: screen values equal stored structured values", async ({ page }) => {
  const data = await client.query(api.results.publicOverview, {});
  test.skip(data.manifests.length === 0, "no finished suite run in this deployment");

  await page.goto("/");
  await expect(page.getByTestId("suite-version")).toHaveText(data.suiteVersion);
  await expect(page.getByTestId("scenario-count")).toHaveText(String(data.scenarios.length));
  const total = data.manifests.reduce((n, m) => n + m.verdict.perScenario.reduce((k, s) => k + s.trials, 0), 0);
  await expect(page.getByTestId("trial-total")).toHaveText(String(total));

  for (const m of data.manifests) {
    const panel = page.getByTestId(`manifest-${m.operatorVersion}`);
    await expect(panel.getByTestId("verdict-text")).toHaveText(m.verdict.text);
    await expect(panel.getByTestId("data-view-mes")).toHaveText(m.dataView.includeMesCycleTimes ? "included" : "not included");
    for (const s of m.verdict.perScenario) {
      const row = panel.getByTestId(`row-${m.operatorVersion}-${s.scenarioId}`);
      await expect(row.getByTestId("passed")).toHaveText(`${s.passed}/${s.trials}`);
      await expect(row.getByTestId("failed")).toHaveText(String(s.failed));
      await expect(row.getByTestId("missing")).toHaveText(String(s.missing));
    }
    for (const g of m.verdict.failures) {
      await expect(panel.getByTestId(`failcount-${g.checkId}-${g.scenarioId}`)).toHaveText(`${g.failedTrials}/${g.trials}`);
    }
  }
});

test("the public page shows no mutating controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Release suite results" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // The page content, not the header: the header has a Sign in button, and in
  // dev Next.js injects its own dev-tools button.
  await expect(page.locator("main").locator("button, form, input, select, textarea, [role=button]")).toHaveCount(0);
});

test("simulation and independent-project labels are visible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Simulation · synthetic factory and data/)).toBeVisible();
  await expect(page.getByText("Independent manufacturing demo")).toBeVisible();
});

test("signed out, review and QA pages show no data and no controls", async ({ page }) => {
  for (const path of ["/review", "/qa"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Sign in to review|QA only/);
    await expect(page.locator("main, section.intro").locator("button, select, table")).toHaveCount(0);
  }
});
