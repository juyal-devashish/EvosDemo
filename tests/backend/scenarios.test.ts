import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { SCENARIOS } from "../../sim/scenarios";
import { OP_V1, OP_V2, asPlanner, businessState, executionsFor, job, makeSupervised, newTest, planFor } from "./fixtures";

// rs-1.0 scenarios seeded into Convex sessions, with the guardrails running
// against the stored factory data.

async function seeded(scenarioId: string) {
  const t = newTest();
  const sessionId = await t.mutation(internal.sessions.seedFromScenario, { scenarioId });
  await t.mutation(internal.permissions.registerManifest, OP_V1);
  await t.mutation(internal.permissions.registerManifest, OP_V2);
  await makeSupervised(t, sessionId, OP_V2.manifestHash);
  return { t, sessionId };
}

describe("seedFromScenario", () => {
  test("seeds every rs-1.0 scenario into its own session", async () => {
    const t = newTest();
    const ids = [];
    for (const s of SCENARIOS) ids.push(await t.mutation(internal.sessions.seedFromScenario, { scenarioId: s.id }));
    const sessions = await t.run((ctx) => ctx.db.query("sessions").collect());
    expect(new Set(ids).size).toBe(8);
    expect(sessions.every((s) => s.kind === "suite" && !s.faultInjection)).toBe(true);
    expect(sessions.find((s) => s.label === "rs-1.0/failed-write")?.injectWriteFailure).toBe(true);
  });

  test("unknown scenario → rejected", async () => {
    const t = newTest();
    await expect(t.mutation(internal.sessions.seedFromScenario, { scenarioId: "nope" })).rejects.toThrow(/not_found/);
  });
});

describe("guardrails on stored factory data", () => {
  test("two jobs can't consume the same reserved stock (G2)", async () => {
    const { t, sessionId } = await seeded("reserved-stock");
    // 100 on hand − 60 reserved = 40 usable before the hour-24 arrival:
    // r1 (50) and o2 (30) both starting now would need 80.
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("r1", "SMT-1", 0, 5), job("o2", "SMT-2", 0, 3), job("t1", "THT-1", 0, 5)]),
    });
    const revision = await t.run((ctx) => ctx.db.get(revisionId));
    expect(revision!.proposalTimeCheck.ok).toBe(false);
    expect(revision!.proposalTimeCheck.failures.map((f) => `${f.id}:${f.orderId}`)).toEqual(["G2:r1", "G2:o2"]);
    await expect(asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId })).rejects.toThrow(/guardrail_failed/);
  });

  test("waiting for the arrival passes and executes", async () => {
    const { t, sessionId } = await seeded("reserved-stock");
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("r1", "SMT-1", 24, 29), job("o2", "SMT-2", 0, 3), job("t1", "THT-1", 0, 5)]),
    });
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });
    expect((await t.mutation(internal.execute.executeAction, { sessionId, actionId })).result).toBe("executed");
  });

  test("slow machine: a standard-speed plan passes every guardrail (drift is caught by C4, not G7)", async () => {
    const { t, sessionId } = await seeded("slow-machine");
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("r1", "SMT-1", 0, 10), job("r2", "SMT-2", 0, 10), job("t1", "THT-1", 0, 5)]),
    });
    expect((await t.run((ctx) => ctx.db.get(revisionId)))!.proposalTimeCheck).toMatchObject({ ok: true, failures: [] });
  });

  test("stale inventory: committing a date on stale stock fails G8 under the manifest's data view", async () => {
    const { t, sessionId } = await seeded("stale-inventory");
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("r1", "SMT-1", 0, 4), job("o2", "SMT-2", 0, 3), job("t1", "THT-1", 0, 5)]),
    });
    const check = (await t.run((ctx) => ctx.db.get(revisionId)))!.proposalTimeCheck;
    expect(check.failures.map((f) => `${f.id}:${f.orderId}`)).toEqual(["G8:r1"]);
  });

  test("failed write: a valid plan is reported failed with no business-state change", async () => {
    const { t, sessionId } = await seeded("failed-write");
    const before = await businessState(t, sessionId);
    const { revisionId } = await t.mutation(internal.proposals.create, {
      sessionId,
      manifestHash: OP_V2.manifestHash,
      trigger: "test",
      ...planFor([job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 0, 6), job("t1", "THT-1", 0, 5)]),
    });
    const { actionId } = await asPlanner(t).mutation(api.queue.approve, { sessionId, revisionId });
    expect((await t.mutation(internal.execute.executeAction, { sessionId, actionId })).result).toBe("failed");
    expect(await businessState(t, sessionId)).toEqual(before);
    expect(await executionsFor(t, actionId)).toMatchObject([{ result: "failed" }]);
  });
});
