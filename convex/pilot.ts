import { v } from "convex/values";
import { evaluatePlan } from "../checks/evaluate";
import { SCENARIOS, seedScenario } from "../sim/scenarios";
import { internal } from "./_generated/api";
import type { ProposeResult } from "./operator";
import { internalAction, internalQuery } from "./_generated/server";

// Day-1 SDK smoke test and cost pilot (plan.md step 3). REAL API CALLS.
// Run only with the user's approval:
//   npx convex run pilot:run '{"stage":"smoke"}'   # 1 call
//   npx convex run pilot:run '{"stage":"pilot"}'   # 4 calls
// Each call reserves budget first; results are stored as attempts.

const STAGES = {
  smoke: [{ scenarioId: "shortage", operatorVersion: "op-v2" }],
  pilot: [
    { scenarioId: "slow-machine", operatorVersion: "op-v1" },
    { scenarioId: "slow-machine", operatorVersion: "op-v2" },
    { scenarioId: "impossible-deadline", operatorVersion: "op-v2" },
    { scenarioId: "stale-inventory", operatorVersion: "op-v2" },
  ],
} as const;

export const revisionFor = internalQuery({
  args: { revisionId: v.id("proposalRevisions") },
  handler: (ctx, { revisionId }) => ctx.db.get(revisionId),
});

type PilotResult = {
  results: {
    scenarioId: string;
    operatorVersion: string;
    status: string;
    costUsd?: number | null;
    usage?: unknown;
    detail?: string;
    verdict: { passed: boolean; failures: string[] } | null;
  }[];
  budget: { capUsd: number; spentUsd: number; reservedUsd: number };
};

export const run = internalAction({
  args: { stage: v.union(v.literal("smoke"), v.literal("pilot")) },
  handler: async (ctx, { stage }): Promise<PilotResult> => {
    const hashes: { opV1: string; opV2: string } = await ctx.runAction(internal.operator.registerManifests, {});
    const results: PilotResult["results"] = [];
    for (const call of STAGES[stage]) {
      const scenario = SCENARIOS.find((s) => s.id === call.scenarioId)!;
      const manifestHash = call.operatorVersion === "op-v1" ? hashes.opV1 : hashes.opV2;
      const sessionId = await ctx.runMutation(internal.sessions.seedFromScenario, {
        scenarioId: call.scenarioId,
        label: `${stage}/${call.operatorVersion}/${call.scenarioId}`,
      });
      const r: ProposeResult = await ctx.runAction(internal.operator.propose, { sessionId, manifestHash, trigger: `${stage}` });
      let verdict: { passed: boolean; failures: string[] } | null = null;
      if (r.revisionId) {
        const revision = await ctx.runQuery(internal.pilot.revisionFor, { revisionId: r.revisionId });
        const v = evaluatePlan(seedScenario(scenario), revision!, {
          includeMesCycleTimes: call.operatorVersion === "op-v2",
          maxDataAgeShifts: call.operatorVersion === "op-v2" ? 2 : undefined,
        });
        verdict = { passed: v.passed, failures: v.failures.map((f) => `${f.id}${"orderId" in f && f.orderId ? `:${f.orderId}` : ""} ${f.message}`) };
      }
      const attempt = await ctx.runQuery(internal.pilot.attempt, { attemptId: r.attemptId });
      results.push({ ...call, status: r.status, costUsd: r.costUsd, usage: attempt?.usage, detail: attempt?.detail, verdict });
    }
    const budget = await ctx.runQuery(internal.budget.status, {});
    return { results, budget };
  },
});

export const attempt = internalQuery({
  args: { attemptId: v.id("attempts") },
  handler: (ctx, { attemptId }) => ctx.db.get(attemptId),
});
