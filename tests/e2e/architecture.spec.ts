import { expect, test } from "@playwright/test";

// The architecture page is static and public: no data, no sign-in, no controls.

test("the Architecture tab opens a page with all four diagrams", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Architecture" }).click();
  await expect(page).toHaveURL(/\/architecture$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How EvosDemo works");
  await expect(page.locator("main svg")).toHaveCount(4);
  for (const title of ["1 · Where things run", "2 · How a plan is made", "3 · How a plan becomes a change, or a refusal", "4 · How trust moves"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
});

test("the diagrams carry the mechanism: boundary order, refusal path and the trust ladder", async ({ page }) => {
  await page.goto("/architecture");
  const main = page.locator("main");
  await expect(main).toContainText("any demotion is committed here, before step 3");
  await expect(main).toContainText("returns normally and never throws");
  await expect(main).toContainText("monitor alarm");
  await expect(main).toContainText("recovery gate");
  // Accessible names state each figure's claim.
  await expect(page.getByRole("img", { name: /executeAction re-checks permission, approval and guardrails/ })).toBeVisible();
});

test("the architecture page has no mutating controls and no horizontal page scroll", async ({ page }) => {
  await page.goto("/architecture");
  await expect(page.locator("main").locator("button, form, input, select, textarea")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
