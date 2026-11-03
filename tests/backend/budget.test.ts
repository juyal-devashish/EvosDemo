import { describe, expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import { OP_V2, newTest, planFor, job, seedSession, type T } from "./fixtures";
import type { Id } from "../../convex/_generated/dataModel";

// Budget reservation and attempt recording (SPEC §8, §11). No model calls:
// tests drive beginAttempt / finishAttempt directly with fixture outcomes.

const PROVENANCE = { sources: [{ source: "erp_routing" as const, ageShifts: 0 }, { source: "erp_stock" as const, ageShifts: 0 }, { source: "mes_cycle_times" as const, ageShifts: 0 }] };
const USAGE = { input_tokens: 2000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const COST = 2000 * 4e-6 + 1000 * 20e-6; // $0.028

async function withCap(t: T, capUsd: number) {
  await t.run((ctx) => ctx.db.insert("budget", { key: "global", capUsd, spentUsd: 0, reservedUsd: 0 }));
}

const begin = (t: T, sessionId: Id<"sessions">, maxCostUsd: number, n = 1) =>
  t.mutation(internal.operator.beginAttempt, { sessionId, manifestHash: OP_V2.manifestHash, model: "claude-opus-5-5", maxCostUsd, n });

const ledger = (t: T) => t.query(internal.budget.status, {});

describe("budget reservation", () => {
  test("5 concurrent dispatches never exceed the cap", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await withCap(t, 1.0);
    // Room for exactly three $0.30 reservations.
    const results = await Promise.all([0, 1, 2, 3, 4].map(() => begin(t, sessionId, 0.3)));
    expect(results.filter((r) => !r.blocked)).toHaveLength(3);
    expect(results.filter((r) => r.blocked)).toHaveLength(2);
    const l = await ledger(t);
    expect(l.reservedUsd).toBeCloseTo(0.9);
    expect(l.spentUsd + l.reservedUsd).toBeLessThanOrEqual(l.capUsd);
    const blocked = await t.run((ctx) => ctx.db.query("attempts").filter((q) => q.eq(q.field("status"), "budget_blocked")).collect());
    expect(blocked).toHaveLength(2);
  });

  test("a reconciled response moves actual cost to spent and frees the rest", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    const { attemptId } = await begin(t, sessionId, 0.2);
    await t.mutation(internal.operator.finishAttempt, { attemptId, status: "refusal", usage: USAGE, stopReason: "refusal", detail: "cyber", provenance: PROVENANCE, trigger: "t" });
    const l = await ledger(t);
    expect(l.reservedUsd).toBeCloseTo(0);
    expect(l.spentUsd).toBeCloseTo(COST);
  });

  test("a lost response keeps its full reservation as spent", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    const { attemptId } = await begin(t, sessionId, 0.2);
    await t.mutation(internal.operator.finishAttempt, { attemptId, status: "timeout", usage: null, detail: "timed out", provenance: PROVENANCE, trigger: "t" });
    expect(await ledger(t)).toMatchObject({ reservedUsd: 0, spentUsd: 0.2 });
    expect(await t.query(internal.budget.reservations, { state: "lost" })).toHaveLength(1);
  });

  test("a retry reserves again", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    await withCap(t, 0.5);
    const first = await begin(t, sessionId, 0.2, 1);
    await t.mutation(internal.operator.finishAttempt, { attemptId: first.attemptId, status: "api_error", usage: null, detail: "529", provenance: PROVENANCE, trigger: "t" });
    const retry = await begin(t, sessionId, 0.2, 2);
    expect(retry.blocked).toBe(false);
    const third = await begin(t, sessionId, 0.2, 3);
    expect(third.blocked).toBe(true); // 0.2 spent + 0.2 reserved + 0.2 > 0.5
  });
});

describe("attempts", () => {
  test("ok → proposal stored with server-side provenance, linked to its attempt", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    const { attemptId } = await begin(t, sessionId, 0.2);
    const plan = planFor([job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 0, 6), job("o3", "THT-1", 0, 5)]);
    const out = await t.mutation(internal.operator.finishAttempt, { attemptId, status: "ok", usage: USAGE, stopReason: "end_turn", plan, provenance: PROVENANCE, trigger: "t" });
    const proposal = await t.run((ctx) => ctx.db.get(out.proposalId!));
    expect(proposal).toMatchObject({ attemptId, provenance: PROVENANCE, manifestHash: OP_V2.manifestHash });
    const attempt = await t.run((ctx) => ctx.db.get(attemptId));
    expect(attempt).toMatchObject({ status: "ok", proposalId: out.proposalId, usage: USAGE });
    expect(attempt!.costUsd).toBeCloseTo(COST);
  });

  test("refusal and parse failures are recorded as failed attempts, never dropped, with no proposal", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    for (const status of ["refusal", "parse_fail"] as const) {
      const { attemptId } = await begin(t, sessionId, 0.2);
      const out = await t.mutation(internal.operator.finishAttempt, { attemptId, status, usage: USAGE, detail: "x", provenance: PROVENANCE, trigger: "t" });
      expect(out.proposalId).toBeUndefined();
      expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status });
    }
    expect(await t.run((ctx) => ctx.db.query("proposals").collect())).toEqual([]);
  });

  test("an attempt can't be finished twice", async () => {
    const t = newTest();
    const sessionId = await seedSession(t);
    const { attemptId } = await begin(t, sessionId, 0.2);
    const args = { attemptId, status: "timeout" as const, usage: null, provenance: PROVENANCE, trigger: "t" };
    await t.mutation(internal.operator.finishAttempt, args);
    await expect(t.mutation(internal.operator.finishAttempt, args)).rejects.toThrow(/not pending/);
    expect((await ledger(t)).spentUsd).toBeCloseTo(0.2);
  });
});

test("registerManifests stores op-v1 and op-v2 under their computed hashes", async () => {
  const t = newTest();
  const hashes = await t.action(internal.operator.registerManifests, {});
  const rows = await t.run((ctx) => ctx.db.query("manifests").collect());
  expect(rows.map((r) => [r.operatorVersion, r.manifestHash]).sort()).toEqual([
    ["op-v1", hashes.opV1],
    ["op-v2", hashes.opV2],
  ]);
  // Idempotent.
  await t.action(internal.operator.registerManifests, {});
  expect(await t.run((ctx) => ctx.db.query("manifests").collect())).toHaveLength(2);
});
