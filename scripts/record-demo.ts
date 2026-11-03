// Records a silent, captioned walkthrough of the live site (both acts).
//   npx tsx scripts/record-demo.ts [baseUrl] [outDir]
// Needs the Clerk keys and E2E_QA_EMAIL in .env.local for the QA scenes.
// Read-only: it never clicks a button that changes state.
import { clerk, clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { chromium, type Page } from "@playwright/test";
import { e2eUser, loadEnvLocal } from "../tests/e2e/env";

const BASE = process.argv[2] ?? "https://evosdemo.vercel.app";
const OUT = process.argv[3] ?? "demo-video";
const SIZE = { width: 1280, height: 800 };

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** A caption bar overlaid on the recording only (not part of the site). */
async function caption(page: Page, text: string, ms = 3500) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      Object.assign(el.style, {
        position: "fixed", left: "50%", bottom: "28px", transform: "translateX(-50%)", zIndex: "2147483647",
        maxWidth: "980px", padding: "12px 18px", borderRadius: "10px", background: "rgba(30,30,30,0.92)",
        color: "#fffffc", font: "500 17px/1.45 Inter, Arial, sans-serif", boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        textAlign: "center", pointerEvents: "none",
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await pause(page, ms);
}

async function scrollTo(page: Page, selector: string, offset = 90) {
  await page.evaluate(
    ([sel, off]) => {
      const el = document.querySelector(sel as string);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (off as number), behavior: "smooth" });
    },
    [selector, offset],
  );
  await pause(page, 1200);
}

async function scrollBy(page: Page, dy: number) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: "smooth" }), dy);
  await pause(page, 1000);
}

async function main() {
  loadEnvLocal();
  await clerkSetup();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  const page = await context.newPage();

  // ── Act 1 ──────────────────────────────────────────────────────────
  await page.goto(BASE);
  await page.getByTestId("verdict-text").first().waitFor();
  await caption(page, "EvosDemo: an AI scheduling operator earns autonomy, release by release. Independent work sample; factory and data are simulated.", 4500);
  await caption(page, "Act 1: every release runs the same suite, rs-1.0: 8 factory scenarios × 10 trials, each a real Claude call.");
  await scrollTo(page, '[data-testid="manifest-op-v1"]');
  await caption(page, "op-v1 can't see observed machine cycle times. It fails: C4 on slow-machine, 10/10 trials.", 4000);
  await scrollTo(page, '[aria-label="Failure evidence for op-v1"]', 220);
  await caption(page, "The evidence: op-v1 plans SMT-2 at the ERP standard, 10 h, but the machine really needs 13 h.", 4000);
  await scrollTo(page, '[data-testid="manifest-op-v2"]');
  await caption(page, "op-v2 includes observed cycle times. It passes rs-1.0: 80/80.", 3500);
  await scrollTo(page, "#diff");
  await caption(page, "The only change between them is the data view. Permissions bind to the manifest hash, so op-v2 starts in shadow.", 4500);

  // ── Act 2 ──────────────────────────────────────────────────────────
  await scrollTo(page, '[data-testid="replay"]', 30);
  await caption(page, "Act 2, labeled fault injection: what if a defect like op-v1's slipped past the gate? op-v1 is given limited autonomy.", 4500);
  await scrollTo(page, ".day-bars", 140);
  await caption(page, "Days 1–3: the synthetic reviewer agrees with every plan. From day 4, SMT-2 runs 30% slow, and op-v1's plans go wrong.", 4500);
  await scrollTo(page, '[data-testid="window-1"]', 260);
  await caption(page, "The monitor's 3-day check: 0 of 17 plans agreed. A healthy AI would look this bad by luck less than 0.0001% of the time. Alarm.", 4500);
  await scrollBy(page, 260);
  await caption(page, "op-v1 is demoted automatically. At the next shift boundary, the backend refuses its queued action.", 4000);

  await page.getByTestId("evidence-link").first().click();
  await page.getByTestId("headline").waitFor();
  await pause(page, 800);
  await caption(page, "The evidence viewer follows the stored records from the refusal back to its cause.", 3500);
  await caption(page, "Refused before execution: nothing was written to the factory (state version unchanged).", 4000);
  await scrollBy(page, 380);
  await caption(page, "Step 2: the demotion it cites. Step 3: the monitor check and why it rang the alarm.", 4000);
  await scrollBy(page, 480);
  await caption(page, "Step 4: the reviews behind the signal: C4 failures, durations more than 10% off.", 3800);
  await scrollBy(page, 900);
  await caption(page, "Step 5: the fix is a data-view change. op-v2 sees the observed cycle times.", 3800);

  // ── Recovery (signed in as qa) ─────────────────────────────────────
  const qa = e2eUser("qa");
  if (qa) {
    await setupClerkTestingToken({ page });
    await page.goto(BASE);
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: qa.identifier });
    await page.goto(`${BASE}/qa`);
    await page.getByRole("combobox", { name: "Session" }).selectOption({ label: "Fault-injection replay: op-v1 given limited autonomy (replay)" });
    await page.getByTestId("qa-level-op-v2").waitFor();
    await pause(page, 800);
    await scrollTo(page, "#session-actions", 120);
    await caption(page, "Recovery: qa authorized op-v2 as supervised. It then made 80 supervised decisions on the slow-SMT-2 factory.", 4500);
    await caption(page, "78/80 agreed. 95% lower bound 0.923, above the pre-set 0.90 floor. qa authorized op-v2 back to limited.", 4500);
    await page.goto(`${BASE}/review`);
    await page.getByRole("combobox", { name: "Session" }).selectOption({ label: "Fault-injection replay: op-v1 given limited autonomy (replay)" });
    await pause(page, 2500);
    await caption(page, "In the replay session: op-v1 demoted, op-v2 in limited autonomy, every proposal with its G1–G8 checks.", 4500);
  }

  await page.goto(BASE);
  await page.getByTestId("verdict-text").first().waitFor();
  await caption(page, "Autonomy is earned by evidence, and lost automatically when the evidence turns. evosdemo.vercel.app", 4500);

  const video = page.video();
  await context.close();
  await browser.close();
  console.log("video:", await video?.path());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
