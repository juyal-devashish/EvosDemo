import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  OP_V1,
  OP_V2,
  REVISED_SCHEDULE,
  asPlanner,
  asQa,
  businessState,
  executionsFor,
  job,
  makeSupervised,
  newTest,
  planFor,
  propose,
  seedSession,
} from "./fixtures";

// SPEC §13 mandatory backend tests covered by step 1, plus the §9.3/§9.2
// approval and supersession rules.

describe("executeAction", () => {
  test("T3: execution writes exactly the authorized revision's diff", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });

    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    expect(out).toMatchObject({ result: "executed", deduplicated: false });
    const after = await businessState(t, sessionId);
    expect(after.stateVersion).toBe(1);
    // Frozen work untouched; movable jobs are exactly the revision's schedule.
    expect(after.jobs.filter((j) => j.frozen)).toEqual([{ ...job("f1", "SMT-1", 0, 4), frozen: true }]);
    expect(after.jobs.filter((j) => !j.frozen).map(({ orderId, lineId, startHour, endHour }) => ({ orderId, lineId, startHour, endHour }))).toEqual(REVISED_SCHEDULE);
    // The recorded diff is exactly the change: o2 moved, o3 added, o1 unchanged.
    const [execution] = await executionsFor(t, actionId);
    expect(execution.diff).toEqual({
      added: [job("o2", "SMT-2", 8, 14), job("o3", "THT-1", 0, 5)],
      removed: [job("o2", "SMT-2", 0, 6)],
    });
  });

  test("a refused execution leaves business state unchanged and is recorded", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    const before = await businessState(t, sessionId);
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });

    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    expect(out.result).toBe("refused");
    expect(await businessState(t, sessionId)).toEqual(before);
    const [execution] = await executionsFor(t, actionId);
    expect(execution).toMatchObject({ result: "refused", stateVersionBefore: 0, stateVersionAfter: 0 });
    const audit = await t.run((ctx) => ctx.db.query("audit").collect());
    expect(audit.some((a) => a.kind === "action.refused" && a.refs.includes(actionId))).toBe(true);
  });

  test("shadow plus a human approval still can't execute", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId } = await asQa(t).mutation(api.queue.approve, { sessionId, revisionId });

    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    expect(out).toMatchObject({ result: "refused", refusalReason: "shadow_never_executes" });
  });

  test("editing a proposal invalidates the earlier approval", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    const { revisionId: r1 } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId: a1 } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId: r1 });

    const r2 = await asPlanner(t).mutation(api.proposals.edit, {
      sessionId,
      revisionId: r1,
      plan: planFor([job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 10, 16)]),
    });

    // The action approved for r1 no longer executes: r2 replaced it.
    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId: a1 });
    expect(out).toMatchObject({ result: "refused", refusalReason: "revision_superseded" });
    // r1's approval doesn't carry over to r2.
    const approvalsForR2 = await t.run((ctx) =>
      ctx.db.query("approvals").withIndex("by_revision", (q) => q.eq("proposalRevisionId", r2)).collect(),
    );
    expect(approvalsForR2).toEqual([]);
    // Approving an old revision is rejected.
    await expect(asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId: r1 })).rejects.toThrow();
  });

  test("demotion committed, then execution → refused (headline guarantee)", async () => {
    const t = newTest();
    const sessionId = await seedSession(t, { faultInjection: true });
    await asQa(t).mutation(api.permissions.faultInjectionOverride, {
      sessionId,
      manifestHash: OP_V1.manifestHash,
      note: "fault-injection replay",
    });
    const { revisionId } = await propose(t, sessionId, OP_V1.manifestHash);
    const actionId = await t.mutation(internal.queue.queueAutonomous, { sessionId, revisionId });
    expect(actionId).not.toBeNull();
    const before = await businessState(t, sessionId);

    const demotionId = await t.mutation(internal.permissions.demote, {
      sessionId,
      manifestHash: OP_V1.manifestHash,
      evidenceIds: ["monitor-window-fixture"],
    });
    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId: actionId! });

    expect(out).toMatchObject({ result: "refused", refusalReason: "not_permitted" });
    expect(await businessState(t, sessionId)).toEqual(before);
    const [execution] = await executionsFor(t, actionId!);
    expect(execution.evidenceIds).toContain(demotionId);
  });

  test("an execution that commits before the demotion stands", async () => {
    const t = newTest();
    const sessionId = await seedSession(t, { faultInjection: true });
    await asQa(t).mutation(api.permissions.faultInjectionOverride, {
      sessionId,
      manifestHash: OP_V1.manifestHash,
      note: "fault-injection replay",
    });
    const { revisionId } = await propose(t, sessionId, OP_V1.manifestHash);
    const actionId = (await t.mutation(internal.queue.queueAutonomous, { sessionId, revisionId }))!;

    expect((await t.mutation(internal.execute.executeAction, { sessionId, actionId })).result).toBe("executed");
    await t.mutation(internal.permissions.demote, { sessionId, manifestHash: OP_V1.manifestHash, evidenceIds: [] });
    // A retry after the demotion returns the committed result, not a refusal.
    expect(await t.mutation(internal.execute.executeAction, { sessionId, actionId })).toMatchObject({
      result: "executed",
      deduplicated: true,
    });
  });

  test("mutation commits, ack lost, retry → exactly one execution", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });

    const first = await t.mutation(internal.execute.executeAction, { sessionId, actionId });
    const retry = await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    expect(first).toMatchObject({ result: "executed", deduplicated: false });
    expect(retry).toMatchObject({ result: "executed", deduplicated: true, executionId: first.executionId });
    expect(await executionsFor(t, actionId)).toHaveLength(1);
    expect((await businessState(t, sessionId)).stateVersion).toBe(1);
  });

  test("a changed stateVersion re-runs guardrails → stale_approval", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    // Approved at stateVersion 0, when THT-1 is free.
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });

    // Before the boundary, other work starts on THT-1 and the state moves on.
    await t.run(async (ctx) => {
      await ctx.db.insert("jobs", { sessionId, ...job("f2", "THT-1", 0, 6), partFamily: "C", frozen: true });
      await ctx.db.patch(sessionId, { stateVersion: 1 });
    });
    const before = await businessState(t, sessionId);

    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    expect(out).toMatchObject({ result: "refused", refusalReason: "stale_approval" });
    expect(await businessState(t, sessionId)).toEqual(before);
    const [execution] = await executionsFor(t, actionId);
    expect(execution.guardrailFailures).toMatchObject([{ id: "G1", orderId: "o3" }]);
  });

  test("injected write failure → committed failed result, no business-state change", async () => {
    const t = newTest();
    const sessionId = await seedSession(t, { injectWriteFailure: true });
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    const before = await businessState(t, sessionId);
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });

    const out = await t.mutation(internal.execute.executeAction, { sessionId, actionId });

    expect(out.result).toBe("failed");
    expect(await businessState(t, sessionId)).toEqual(before);
    expect(await executionsFor(t, actionId)).toHaveLength(1);
  });
});
