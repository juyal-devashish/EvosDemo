import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { OP_V1, OP_V2, asPlanner, asQa, executionsFor, makeSupervised, newTest, propose, seedSession, type T } from "./fixtures";

// Shift boundary, monitor and recovery, with fixture reviews (no AI).
// Replay sessions use 6 decision slots per day: shift 18 starts day 4.

async function replaySession(t: T) {
  const sessionId = await seedSession(t, { faultInjection: true });
  await t.run(async (ctx) => {
    await ctx.db.patch(sessionId, { slotsPerDay: 6, currentShift: 17 });
    // Data refreshed at the current shift; otherwise G8 rightly refuses every commitment.
    const f = await ctx.db.query("factory").withIndex("by_session", (q) => q.eq("sessionId", sessionId)).unique();
    await ctx.db.patch(f!._id, { dataAsOfShift: { erp_routing: 17, erp_stock: 17, mes_cycle_times: 17 } });
  });
  await asQa(t).mutation(api.permissions.faultInjectionOverride, { sessionId, manifestHash: OP_V1.manifestHash, note: "fault-injection replay" });
  return sessionId;
}

async function addReviews(t: T, sessionId: Id<"sessions">, manifestHash: string, day: number, agreed: number, edited: number, mode: "post_execution" | "supervised" = "post_execution", pending = 0) {
  const { revisionId } = await propose(t, sessionId, manifestHash);
  const rows = [...Array(agreed).fill(true), ...Array(edited).fill(false), ...Array(pending).fill(null)];
  for (const a of rows) {
    await t.mutation(internal.monitor.addReview, {
      sessionId,
      manifestHash,
      proposalRevisionId: revisionId,
      mode,
      proposalDay: day,
      agreed: a,
      shouldEdit: a === false,
      reasons: a === false ? ["C4"] : [],
      reviewedOnDay: a === null ? undefined : day,
    });
  }
}

describe("shift boundary", () => {
  test("headline: the monitor demotes at the boundary, then the queued action is refused", async () => {
    const t = newTest();
    const sessionId = await replaySession(t);
    await addReviews(t, sessionId, OP_V1.manifestHash, 2, 4, 14); // days 1–3 window: 4/18 agreed
    const { revisionId } = await propose(t, sessionId, OP_V1.manifestHash);
    const actionId = (await t.mutation(internal.queue.queueAutonomous, { sessionId, revisionId }))!;

    const out = await t.action(internal.boundary.run, { sessionId });

    expect(out.toShift).toBe(18);
    expect(out.demotionIds).toHaveLength(1);
    expect(out.outcomes).toEqual([{ actionId, result: "refused", refusalReason: "not_permitted" }]);
    const [execution] = await executionsFor(t, actionId);
    expect(execution.evidenceIds).toContain(out.demotionIds[0]);
    const windows = await t.run((ctx) => ctx.db.query("monitorWindows").collect());
    expect(windows).toMatchObject([{ windowIndex: 0, status: "signal", n: 18, x: 4 }]);
    expect(await t.query(api.permissions.get, { sessionId, manifestHash: OP_V1.manifestHash })).toEqual({ level: "demoted", viaFaultInjection: true });
  });

  test("healthy agreement: no demotion, and the queued action executes", async () => {
    const t = newTest();
    const sessionId = await replaySession(t);
    await addReviews(t, sessionId, OP_V1.manifestHash, 2, 18, 0);
    const { revisionId } = await propose(t, sessionId, OP_V1.manifestHash);
    await t.mutation(internal.queue.queueAutonomous, { sessionId, revisionId });
    const out = await t.action(internal.boundary.run, { sessionId });
    expect(out.demotionIds).toEqual([]);
    expect(out.outcomes.map((o) => o.result)).toEqual(["executed"]);
  });

  test("mutation commits, step throws before acknowledging, retry → exactly one execution", async () => {
    const t = newTest();
    const sessionId = await replaySession(t);
    const { revisionId } = await propose(t, sessionId, OP_V1.manifestHash);
    const actionId = (await t.mutation(internal.queue.queueAutonomous, { sessionId, revisionId }))!;
    // Steps 1–2, then the execution commits, then the job dies before marking step 3 done.
    await t.mutation(internal.boundary.closePeriod, { sessionId, toShift: 18 });
    await t.mutation(internal.boundary.evaluateRule, { sessionId, toShift: 18 });
    await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    const retry = await t.action(internal.boundary.run, { sessionId }); // resumes the open boundary to 18
    expect(retry.toShift).toBe(18);
    expect(await executionsFor(t, actionId)).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(sessionId)))!.currentShift).toBe(18);
  });

  test("pending reviews never count as agreement; the window waits, then counts them as pending", async () => {
    const t = newTest();
    const sessionId = await replaySession(t);
    await addReviews(t, sessionId, OP_V1.manifestHash, 2, 15, 0, "post_execution", 5);
    await t.action(internal.boundary.run, { sessionId }); // day 4: pending, within grace → wait
    expect(await t.run((ctx) => ctx.db.query("monitorWindows").collect())).toEqual([]);
    // Jump to the first day after the grace period (day 6 → shift 30).
    await t.run((ctx) => ctx.db.patch(sessionId, { currentShift: 35 }));
    await t.action(internal.boundary.run, { sessionId });
    expect(await t.run((ctx) => ctx.db.query("monitorWindows").collect())).toMatchObject([{ n: 15, x: 15, pending: 5, status: "ok" }]);
  });

  test("only qa can advance the clock", async () => {
    const t = newTest();
    const sessionId = await replaySession(t);
    await expect(asPlanner(t).mutation(api.boundary.advance, { sessionId })).rejects.toThrow(/forbidden/);
  });
});

describe("recovery to limited", () => {
  async function recoverable(t: T) {
    const sessionId = await replaySession(t);
    await addReviews(t, sessionId, OP_V1.manifestHash, 2, 4, 14);
    await t.action(internal.boundary.run, { sessionId }); // demotes op-v1
    await makeSupervised(t, sessionId, OP_V2.manifestHash); // records a passed verdict without slow-machine
    return sessionId;
  }

  const recordFullSuite = (t: T, sessionId: Id<"sessions">) =>
    t.mutation(internal.permissions.recordSuiteVerdict, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      suiteVersion: "rs-1.0",
      verdict: "passed",
      scenarioIds: ["shortage", "slow-machine"],
    });

  test("needs the suite with the regression scenario", async () => {
    const t = newTest();
    const sessionId = await recoverable(t);
    await addReviews(t, sessionId, OP_V2.manifestHash, 8, 80, 0, "supervised");
    await expect(asQa(t).mutation(api.permissions.promoteToLimited, { sessionId, manifestHash: OP_V2.manifestHash })).rejects.toThrow(/suite_not_passed/);
  });

  test("76/80 (bound 0.889) → insufficient; 77/80 (0.906) → limited", async () => {
    const t = newTest();
    const sessionId = await recoverable(t);
    await recordFullSuite(t, sessionId);
    await addReviews(t, sessionId, OP_V2.manifestHash, 8, 76, 4, "supervised");
    await expect(asQa(t).mutation(api.permissions.promoteToLimited, { sessionId, manifestHash: OP_V2.manifestHash })).rejects.toThrow(/insufficient_evidence/);
    expect(await t.query(api.permissions.get, { sessionId, manifestHash: OP_V2.manifestHash })).toMatchObject({ level: "supervised" });

    const t2 = newTest();
    const s2 = await recoverable(t2);
    await recordFullSuite(t2, s2);
    await addReviews(t2, s2, OP_V2.manifestHash, 8, 77, 3, "supervised");
    await asQa(t2).mutation(api.permissions.promoteToLimited, { sessionId: s2, manifestHash: OP_V2.manifestHash });
    expect(await t2.query(api.permissions.get, { sessionId: s2, manifestHash: OP_V2.manifestHash })).toMatchObject({ level: "limited" });
  });

  test("fewer than 80 fresh reviews → insufficient, even if all agree", async () => {
    const t = newTest();
    const sessionId = await recoverable(t);
    await recordFullSuite(t, sessionId);
    await addReviews(t, sessionId, OP_V2.manifestHash, 8, 79, 0, "supervised");
    await expect(asQa(t).mutation(api.permissions.promoteToLimited, { sessionId, manifestHash: OP_V2.manifestHash })).rejects.toThrow(/insufficient_evidence/);
  });

  test("promotion requires qa", async () => {
    const t = newTest();
    const sessionId = await recoverable(t);
    await recordFullSuite(t, sessionId);
    await addReviews(t, sessionId, OP_V2.manifestHash, 8, 80, 0, "supervised");
    await expect(asPlanner(t).mutation(api.permissions.promoteToLimited, { sessionId, manifestHash: OP_V2.manifestHash })).rejects.toThrow(/forbidden/);
  });
});
