import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SCENARIOS } from "../../sim/scenarios";
import { OP_V2, asPlanner, asQa, businessState, job, newTest, planFor, seedSession, type T } from "./fixtures";

// Release-suite bookkeeping. Scheduled trial actions are never run here
// (they would call the model); outcomes are recorded directly.

async function setup(trialsPerScenario = 1, scenarioIds?: string[]) {
  const t = newTest();
  const anySession = await seedSession(t); // registers the fixture manifests
  const suiteRunId = await t.mutation(internal.suite.startFromCli, {
    manifestHash: OP_V2.manifestHash,
    trialsPerScenario,
    scenarioIds,
  });
  const trials = await t.run((ctx) => ctx.db.query("trials").collect());
  return { t, suiteRunId, trials, anySession };
}

const record = (t: T, trialId: Id<"trials">, state: "passed" | "failed" | "missing", extra: Record<string, unknown> = {}) =>
  t.mutation(internal.suite.recordTrial, { trialId, state, ...extra });

describe("suite runs", () => {
  test("start creates one isolated, seeded session and one scheduled run per trial", async () => {
    const { t, trials } = await setup(10);
    expect(trials).toHaveLength(80);
    expect(new Set(trials.map((x) => x.sessionId)).size).toBe(80);
    expect(new Set(trials.map((x) => x.trialKey)).size).toBe(80);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name.includes("runTrial"))).toHaveLength(80);
    const failedWrite = trials.find((x) => x.scenarioId === "failed-write")!;
    expect((await t.run((ctx) => ctx.db.get(failedWrite.sessionId)))!.injectWriteFailure).toBe(true);
  });

  test("only qa can start a run", async () => {
    const t = newTest();
    await seedSession(t);
    await expect(asPlanner(t).mutation(api.suite.start, { manifestHash: OP_V2.manifestHash })).rejects.toThrow(/forbidden/);
  });

  test("all trials passed → verdict passed, and qa can promote the manifest", async () => {
    const { t, suiteRunId, trials, anySession } = await setup();
    for (const tr of trials) await record(t, tr._id, "passed");
    const { run } = (await t.query(api.suite.getRun, { suiteRunId }))!;
    expect(run.state).toBe("complete");
    expect(run.verdict!.text).toMatch(/^Passed rs-1.0 \(8 scenarios, 1 trial each, manifest hash…\)$/);
    await asQa(t).mutation(api.permissions.promoteToSupervised, { sessionId: anySession, manifestHash: OP_V2.manifestHash });
    expect(await t.query(api.permissions.get, { sessionId: anySession, manifestHash: OP_V2.manifestHash })).toMatchObject({ level: "supervised" });
  });

  test("a failed trial fails the suite and blocks promotion", async () => {
    const { t, suiteRunId, trials, anySession } = await setup();
    for (const tr of trials) {
      if (tr.scenarioId === "slow-machine") await record(t, tr._id, "failed", { failures: [{ id: "C4", message: "planned 10 h vs true 13 h", orderId: "r2" }] });
      else await record(t, tr._id, "passed");
    }
    expect((await t.query(api.suite.getRun, { suiteRunId }))!.run.verdict!.text).toBe("Failed: C4 on slow-machine, 1/1 trials");
    await expect(
      asQa(t).mutation(api.permissions.promoteToSupervised, { sessionId: anySession, manifestHash: OP_V2.manifestHash }),
    ).rejects.toThrow(/suite_not_passed/);
  });

  test("cancelled / partial suite → incomplete, never a pass", async () => {
    const { t, suiteRunId, trials, anySession } = await setup();
    for (const tr of trials.slice(0, 5)) await record(t, tr._id, "passed");
    await t.mutation(internal.suite.cancelFromCli, { suiteRunId });
    const { run, counts } = (await t.query(api.suite.getRun, { suiteRunId }))!;
    expect(run.state).toBe("cancelled");
    expect(counts).toMatchObject({ passed: 5, missing: 3, pending: 0 });
    expect(run.verdict!.text).toBe("Incomplete (3 trials missing: cancelled)");
    await expect(
      asQa(t).mutation(api.permissions.promoteToSupervised, { sessionId: anySession, manifestHash: OP_V2.manifestHash }),
    ).rejects.toThrow(/suite_not_passed/);
  });

  test("a budget-blocked first attempt → missing, suite incomplete", async () => {
    const { t, suiteRunId, trials } = await setup();
    await record(t, trials[0]._id, "missing", { missingReason: "budget" });
    for (const tr of trials.slice(1)) await record(t, tr._id, "passed");
    expect((await t.query(api.suite.getRun, { suiteRunId }))!.run.verdict).toMatchObject({
      kind: "incomplete",
      text: "Incomplete (1 trial missing: budget)",
    });
  });

  test("a run over part of the suite can't pass the release gate", async () => {
    const { t, trials } = await setup(2, ["shortage"]);
    for (const tr of trials) await record(t, tr._id, "passed");
    const verdicts = await t.run((ctx) => ctx.db.query("suiteVerdicts").collect());
    expect(verdicts).toMatchObject([{ verdict: "incomplete", scenarioIds: ["shortage"] }]);
  });

  test("the first recorded result wins; a late retry can't replace it", async () => {
    const { t, trials } = await setup();
    await record(t, trials[0]._id, "failed", { failures: [{ id: "C2", message: "x" }] });
    await record(t, trials[0]._id, "passed");
    expect((await t.run((ctx) => ctx.db.get(trials[0]._id)))!.state).toBe("failed");
  });

  test("a trial of a cancelled run is recorded missing without calling the model", async () => {
    const { t, suiteRunId, trials } = await setup();
    await t.mutation(internal.suite.cancelFromCli, { suiteRunId });
    await t.action(internal.suite.runTrial, { trialId: trials[0]._id }); // returns before any model call
    expect(await t.run((ctx) => ctx.db.query("attempts").collect())).toEqual([]);
  });
});

describe("failed-write harness", () => {
  test("a valid plan executed in the failed-write trial session reports failed with no state change", async () => {
    const { t, trials } = await setup(1, ["failed-write"]);
    const trial = trials[0];
    const before = await businessState(t, trial.sessionId);
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId: trial.sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 0, 6), job("t1", "THT-1", 0, 5)]),
    });
    expect(await t.mutation(internal.suite.checkFailedWrite, { trialId: trial._id, revisionId })).toEqual({
      ok: true,
      detail: "failed, no business-state change",
    });
    expect(await businessState(t, trial.sessionId)).toEqual(before);
    const changes = await t.run((ctx) => ctx.db.query("permissionChanges").collect());
    expect(changes.map((c) => c.trigger)).toEqual(["suite_harness"]);
  });

  test("refuses to run outside a failed-write suite session", async () => {
    const { t, trials } = await setup(1, ["shortage"]);
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId: trials[0].sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("r1", "SMT-1", 16, 20)]),
    });
    await expect(t.mutation(internal.suite.checkFailedWrite, { trialId: trials[0]._id, revisionId })).rejects.toThrow(/invariant/);
  });
});

test("rs-1.0 has 8 scenarios", () => expect(SCENARIOS).toHaveLength(8));
