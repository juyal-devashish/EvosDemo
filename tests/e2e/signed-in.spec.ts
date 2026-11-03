import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { convexUrl, e2eUser } from "./env";

// Signed-in flows with the Clerk test users from .env.local, plus the
// headline refusal in the recorded replay. Read-only: nothing here changes
// state. No AI calls.

const client = new ConvexHttpClient(convexUrl());

async function signInAs(page: Page, role: "qa" | "planner") {
  const user = e2eUser(role);
  test.skip(user === null, `E2E_${role.toUpperCase()}_EMAIL/PASSWORD not set`);
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.loaded({ page });
  // Ticket sign-in (created with the secret key): no password or device
  // verification step, which a fresh test browser would otherwise hit.
  await clerk.signIn({ page, emailAddress: user!.identifier });
  await page.goto("/");
  await expect(page.getByTestId("role")).toHaveText(role);
}

test("qa sees Review and QA; the QA console lists sessions", async ({ page }) => {
  await signInAs(page, "qa");
  await expect(page.getByRole("link", { name: "Review" })).toBeVisible();
  await page.getByRole("link", { name: "QA" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("QA console");
});

test("planner sees Review but not QA, and the QA page refuses them", async ({ page }) => {
  await signInAs(page, "planner");
  await expect(page.getByRole("link", { name: "Review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "QA" })).toHaveCount(0);
  await page.goto("/qa");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("QA only");
});

test("headline: the replay's refused action shows its evidence, and screen equals stored values (T2)", async ({ page }) => {
  const timeline = await client.query(api.evidence.replayTimeline, {});
  test.skip(timeline === null || timeline.refusedActionIds.length === 0, "no recorded replay refusal");
  const actionId = timeline!.refusedActionIds[0];
  const e = (await client.query(api.evidence.forAction, { actionId }))!;

  await page.goto("/");
  await page.getByTestId("evidence-link").first().click();
  await expect(page).toHaveURL(new RegExp(`/evidence/${actionId}$`));
  await expect(page.getByRole("note").filter({ hasText: "Fault injection." }).first()).toBeVisible();
  await expect(page.getByTestId("headline")).toContainText("Refused before execution");
  await expect(page.getByTestId("reason")).toHaveText(e.action.refusalReason!);
  await expect(page.getByTestId("executed")).toHaveText("no");
  await expect(page.getByTestId("permission-change")).toHaveText("Limited autonomy → Demoted (supervised)");
  await expect(page.getByTestId("window-agreement")).toContainText(`${e.window!.x} of ${e.window!.n}`);
  // Plain language only: no scientific notation anywhere in the evidence chain.
  await expect(page.getByTestId("window-chance")).toHaveText("less than 0.0001%");
  await expect(page.locator("main")).not.toContainText(/\de-\d/);
});
