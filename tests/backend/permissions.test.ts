import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  OP_V1,
  OP_V2,
  REVISED_SCHEDULE,
  asPlanner,
  asQa,
  businessState,
  job,
  makeSupervised,
  newTest,
  planFor,
  propose,
  seedSession,
} from "./fixtures";

describe("manifest binding", () => {
  test("a new manifest can't inherit another manifest's permission", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);

    expect(await t.query(api.permissions.get, { sessionId, manifestHash: OP_V1.manifestHash })).toMatchObject({
      level: "shadow",
    });
    const { revisionId } = await propose(t, sessionId, OP_V1.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });
    expect(await t.mutation(internal.execute.executeAction, { sessionId, actionId })).toMatchObject({
      result: "refused",
      refusalReason: "shadow_never_executes",
    });
  });

  test("promotion to supervised needs a passed suite verdict for this exact manifest", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await expect(
      asQa(t).mutation(api.permissions.promoteToSupervised, { sessionId, manifestHash: OP_V1.manifestHash }),
    ).rejects.toThrow(/suite_not_passed/);

    await t.mutation(internal.permissions.recordSuiteVerdict, {
      sessionId,
      manifestHash: OP_V1.manifestHash,
      suiteVersion: "rs-1.0",
      verdict: "failed",
      scenarioIds: ["slow-machine"],
    });
    await t.mutation(internal.permissions.recordSuiteVerdict, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      suiteVersion: "rs-1.0",
      verdict: "passed",
      scenarioIds: ["all"],
    });
    // op-v2's pass doesn't count for op-v1, and a failed verdict doesn't count at all.
    await expect(
      asQa(t).mutation(api.permissions.promoteToSupervised, { sessionId, manifestHash: OP_V1.manifestHash }),
    ).rejects.toThrow(/suite_not_passed/);
  });
});

describe("roles are checked server-side", () => {
  test("wrong role or no identity calling mutations directly → rejected", async () => {
    const t = newTest();
    const sessionId = await seedSession(t, { faultInjection: true });
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash);
    const anon = t;
    const noRole = t.withIdentity({ subject: "someone" });

    // qa-only
    for (const caller of [anon, noRole, asPlanner(t)]) {
      await expect(
        caller.mutation(api.permissions.promoteToSupervised, { sessionId, manifestHash: OP_V2.manifestHash }),
      ).rejects.toThrow(/unauthenticated|forbidden/);
      await expect(
        caller.mutation(api.permissions.faultInjectionOverride, {
          sessionId,
          manifestHash: OP_V1.manifestHash,
          note: "x",
        }),
      ).rejects.toThrow(/unauthenticated|forbidden/);
      await expect(
        caller.mutation(api.sessions.create, { label: "x", kind: "test", faultInjection: false }),
      ).rejects.toThrow(/unauthenticated|forbidden/);
    }
    // planner or qa
    for (const caller of [anon, noRole]) {
      await expect(caller.mutation(api.queue.approve, { sessionId, revisionId })).rejects.toThrow(
        /unauthenticated|forbidden/,
      );
      await expect(
        caller.mutation(api.proposals.edit, { sessionId, revisionId, plan: planFor(REVISED_SCHEDULE) }),
      ).rejects.toThrow(/unauthenticated|forbidden/);
    }
    // Nothing above changed any state.
    expect(await t.run((ctx) => ctx.db.query("approvals").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("permissions").collect())).toEqual([]);
  });
});

describe("fault-injection override", () => {
  test("only allowed in sessions flagged faultInjection", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await expect(
      asQa(t).mutation(api.permissions.faultInjectionOverride, {
        sessionId,
        manifestHash: OP_V1.manifestHash,
        note: "x",
      }),
    ).rejects.toThrow(/fault_injection_not_allowed/);
  });

  test("a demo session can't be created with fault injection", async () => {
    const t = newTest();
    await expect(
      asQa(t).mutation(api.sessions.create, { label: "public demo", kind: "demo", faultInjection: true }),
    ).rejects.toThrow(/fault injection/);
  });

  test("the override is recorded and labeled; demotion keeps the label", async () => {
    const t = newTest();
    const sessionId = await seedSession(t, { faultInjection: true });
    await asQa(t).mutation(api.permissions.faultInjectionOverride, {
      sessionId,
      manifestHash: OP_V1.manifestHash,
      note: "replay",
    });
    expect(await t.query(api.permissions.get, { sessionId, manifestHash: OP_V1.manifestHash })).toEqual({
      level: "limited",
      viaFaultInjection: true,
    });
    await t.mutation(internal.permissions.demote, { sessionId, manifestHash: OP_V1.manifestHash, evidenceIds: [] });
    expect(await t.query(api.permissions.get, { sessionId, manifestHash: OP_V1.manifestHash })).toEqual({
      level: "demoted",
      viaFaultInjection: true,
    });
    const changes = await t.run((ctx) => ctx.db.query("permissionChanges").collect());
    expect(changes.map((c) => [c.from, c.to, c.trigger])).toEqual([
      ["shadow", "limited", "fault_injection_override"],
      ["limited", "demoted", "monitor_signal"],
    ]);
  });

  test("demote is a no-op unless the manifest has limited autonomy", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    expect(
      await t.mutation(internal.permissions.demote, { sessionId, manifestHash: OP_V2.manifestHash, evidenceIds: [] }),
    ).toBeNull();
  });
});

describe("queue", () => {
  test("a newer approved revision supersedes the queued one for the same shift", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await makeSupervised(t, sessionId, OP_V2.manifestHash);
    const { revisionId: rA } = await propose(t, sessionId, OP_V2.manifestHash);
    const { revisionId: rB } = await propose(t, sessionId, OP_V2.manifestHash, [job("o1", "SMT-1", 4, 8)]);
    const { actionId: aA } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId: rA });
    const { actionId: aB } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId: rB });

    expect(await t.mutation(internal.execute.executeAction, { sessionId, actionId: aA })).toMatchObject({
      result: "refused",
      refusalReason: "superseded",
      deduplicated: true,
    });
    expect((await t.mutation(internal.execute.executeAction, { sessionId, actionId: aB })).result).toBe("executed");
  });

  test("a revision that fails guardrails can't be approved", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    // Overlaps frozen f1 (SMT-1, 0–4).
    const { revisionId } = await propose(t, sessionId, OP_V2.manifestHash, [job("o1", "SMT-1", 2, 6)]);
    await expect(asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId })).rejects.toThrow(
      /guardrail_failed/,
    );
  });
});

describe("session isolation", () => {
  test("two sessions run concurrently without cross-contamination", async () => {
    const t = newTest();
    const [s1, s2] = await Promise.all([seedSession(t, { label: "s1" }), seedSession(t, { label: "s2" })]);
    await makeSupervised(t, s1, OP_V2.manifestHash);
    // s2 never promotes: its permission is still shadow.
    const [p1, p2] = await Promise.all([propose(t, s1, OP_V2.manifestHash), propose(t, s2, OP_V2.manifestHash)]);
    const [q1, q2] = await Promise.all([
      asPlanner(t).mutation(api.queue.approve, { sessionId: s1, revisionId: p1.revisionId }),
      asPlanner(t).mutation(api.queue.approve, { sessionId: s2, revisionId: p2.revisionId }),
    ]);
    const s2Before = await businessState(t, s2);

    const [o1, o2] = await Promise.all([
      t.mutation(internal.execute.executeAction, { sessionId: s1, actionId: q1.actionId }),
      t.mutation(internal.execute.executeAction, { sessionId: s2, actionId: q2.actionId }),
    ]);

    expect(o1.result).toBe("executed");
    expect(o2).toMatchObject({ result: "refused", refusalReason: "shadow_never_executes" });
    expect(await businessState(t, s2)).toEqual(s2Before);
    expect((await businessState(t, s1)).stateVersion).toBe(1);
  });

  test("records from another session are treated as missing", async () => {
    const t = newTest();
    const [s1, s2] = await Promise.all([seedSession(t), seedSession(t)]);
    const { revisionId } = await propose(t, s1, OP_V2.manifestHash);
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId: s1, revisionId });

    await expect(t.mutation(internal.execute.executeAction, { sessionId: s2, actionId })).rejects.toThrow(/not_found/);
    await expect(asPlanner(t).mutation(api.queue.approve, { sessionId: s2, revisionId })).rejects.toThrow(/not_found/);
  });
});
