import { convexTest, type TestConvex } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import type { ScheduledJob } from "../../sim/domain";
import { modules } from "./modules";

// Deterministic fixtures for backend tests. No AI, no real clock dependence.

export type T = TestConvex<typeof schema>;

export const newTest = (): T => convexTest(schema, modules);

const baseManifest = {
  promptHash: "prompt-hash-fixture",
  model: "claude-opus-5-5",
  effort: "low",
  maxTokens: 4000,
  guardrailVersion: "g-1.0",
  policyVersion: "p-0.1",
  suiteVersion: "rs-1.0",
  scope: "scheduling" as const,
};

export const OP_V1 = {
  ...baseManifest,
  manifestHash: "hash-op-v1",
  operatorVersion: "op-v1",
  dataView: { includeMesCycleTimes: false },
};

export const OP_V2 = {
  ...baseManifest,
  manifestHash: "hash-op-v2",
  operatorVersion: "op-v2",
  dataView: { includeMesCycleTimes: true, maxDataAgeShifts: 2 },
};

export const job = (orderId: string, lineId: string, startHour: number, endHour: number): ScheduledJob => ({
  orderId,
  lineId,
  startHour,
  endHour,
});

/** Frozen f1 (family A) on SMT-1; movable o1 (SMT-1) and o2 (SMT-2). */
export const INITIAL_JOBS = [
  { ...job("f1", "SMT-1", 0, 4), partFamily: "A", frozen: true },
  { ...job("o1", "SMT-1", 4, 8), partFamily: "A", frozen: false },
  { ...job("o2", "SMT-2", 0, 6), partFamily: "B", frozen: false },
];

const full = [{ start: 0, end: 48 }];
const std = (lineId: string, partFamily: string) => ({ lineId, partFamily, hoursPerUnit: 0.1 });
const openOrder = (orderId: string, lineType: "SMT" | "THT", partFamily: string, qty: number) => ({
  orderId,
  lineType,
  partFamily,
  qty,
  dueHour: 48,
  rush: false,
  priorityRank: 1,
  bom: [],
});

/** Three lines at 0.1 h/unit; o1 = 4 h, o2 = 6 h, o3 = 5 h. All data fresh. */
export const FACTORY = {
  lines: [
    { lineId: "SMT-1", lineType: "SMT" as const, availability: full },
    { lineId: "SMT-2", lineType: "SMT" as const, availability: full },
    { lineId: "THT-1", lineType: "THT" as const, availability: full },
  ],
  orders: [openOrder("o1", "SMT", "A", 40), openOrder("o2", "SMT", "B", 60), openOrder("o3", "THT", "C", 50)],
  standardCycleTimes: [std("SMT-1", "A"), std("SMT-1", "B"), std("SMT-2", "A"), std("SMT-2", "B"), std("THT-1", "C")],
  mesObservations: [],
  stock: [],
  arrivals: [],
  reservations: [],
  dataAsOfShift: { erp_routing: 0, erp_stock: 0, mes_cycle_times: 0 },
};

/** A valid whole-schedule revision: move o2 to later on SMT-2, add o3 on THT-1. */
export const REVISED_SCHEDULE = [job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 8, 14), job("o3", "THT-1", 0, 5)];

export const planFor = (schedule: ScheduledJob[]) => ({
  schedule,
  dispositions: schedule.map((j) => ({
    orderId: j.orderId,
    status: "scheduled" as const,
    commitment: "on_time" as const,
  })),
  escalations: [],
  summary: "fixture plan",
});

export const asQa = (t: T) => t.withIdentity({ subject: "qa-1", role: "qa" });
export const asPlanner = (t: T) => t.withIdentity({ subject: "planner-1", role: "planner" });

export async function seedSession(
  t: T,
  opts: { faultInjection?: boolean; injectWriteFailure?: boolean; label?: string } = {},
) {
  const sessionId = await t.mutation(internal.sessions.seed, {
    label: opts.label ?? "test",
    kind: "test",
    faultInjection: opts.faultInjection ?? false,
    injectWriteFailure: opts.injectWriteFailure,
    factory: FACTORY,
    jobs: INITIAL_JOBS,
  });
  await t.mutation(internal.permissions.registerManifest, OP_V1);
  await t.mutation(internal.permissions.registerManifest, OP_V2);
  return sessionId;
}

export async function propose(t: T, sessionId: Id<"sessions">, manifestHash: string, schedule = REVISED_SCHEDULE) {
  return t.mutation(internal.proposals.create, {
    sessionId,
    manifestHash,
    trigger: "fixture",
    ...planFor(schedule),
  });
}

/** Record a passed rs-1.0 verdict for the manifest and have qa promote it to supervised. */
export async function makeSupervised(t: T, sessionId: Id<"sessions">, manifestHash: string) {
  await t.mutation(internal.permissions.recordSuiteVerdict, {
    sessionId,
    manifestHash,
    suiteVersion: "rs-1.0",
    verdict: "passed",
    scenarioIds: ["fixture"],
  });
  await asQa(t).mutation(api.permissions.promoteToSupervised, { sessionId, manifestHash });
}

/** Business state of a session: its jobs and stateVersion. */
export async function businessState(t: T, sessionId: Id<"sessions">) {
  return t.run(async (ctx) => {
    const session = await ctx.db.get(sessionId);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return {
      stateVersion: session?.stateVersion,
      jobs: jobs
        .map(({ orderId, lineId, startHour, endHour, frozen }) => ({ orderId, lineId, startHour, endHour, frozen }))
        .sort((a, b) => a.orderId.localeCompare(b.orderId)),
    };
  });
}

export async function executionsFor(t: T, actionId: Id<"actions">) {
  return t.run((ctx) =>
    ctx.db
      .query("executions")
      .withIndex("by_action", (q) => q.eq("actionId", actionId))
      .collect(),
  );
}
