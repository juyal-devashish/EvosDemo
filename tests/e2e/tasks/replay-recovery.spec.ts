import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { e2eUser } from "../env";

// STATE-CHANGING tasks for the recorded replay, done through the real QA
// console as the qa test user (so the permission history records a qa
// authorization). Not part of the normal suite. Run with:
//   E2E_TASKS=1 npx playwright test tests/e2e/tasks -g "<name>"

const REPLAY = "Fault-injection replay: op-v1 given limited autonomy (replay)";

async function openReplayInQa(page: import("@playwright/test").Page) {
  const user = e2eUser("qa");
  test.skip(user === null, "E2E_QA_EMAIL not set");
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: user!.identifier });
  await page.goto("/qa");
  await page.getByRole("combobox", { name: "Session" }).selectOption({ label: REPLAY });
}

test("authorize op-v2 supervised in the replay", async ({ page }) => {
  await openReplayInQa(page);
  const level = page.getByTestId("qa-level-op-v2");
  if ((await level.textContent()) === "Shadow") await page.getByTestId("promote-op-v2").click();
  await expect(level).toHaveText("Supervised");
});

test("authorize op-v2 limited in the replay", async ({ page }) => {
  await openReplayInQa(page);
  await page.getByTestId("limited-op-v2").click();
  await expect(page.getByTestId("qa-level-op-v2")).toHaveText("Limited autonomy");
});
