import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { writeAudit } from "./lib/records";
import { SCENARIOS, seedScenario as verifyScenario } from "../sim/scenarios";
import { factoryFields, seedJob } from "./lib/validators";

const sessionKind = v.union(
  v.literal("suite"),
  v.literal("replay"),
  v.literal("demo"),
  v.literal("test"),
);

export async function insertSession(
  ctx: MutationCtx,
  actor: Actor,
  args: { label: string; kind: "suite" | "replay" | "demo" | "test"; faultInjection: boolean; injectWriteFailure?: boolean },
) {
  if (args.kind === "demo" && args.faultInjection) {
    // The public demo session never allows the fault-injection override (§9.4).
    throw new ConvexError({ code: "invalid", message: "demo sessions can't use fault injection" });
  }
  const sessionId = await ctx.db.insert("sessions", {
    label: args.label,
    kind: args.kind,
    faultInjection: args.faultInjection,
    injectWriteFailure: args.injectWriteFailure ?? false,
    currentShift: 0,
    stateVersion: 0,
  });
  await writeAudit(ctx, { sessionId, kind: "session.created", actor, refs: [sessionId] });
  return sessionId;
}

export const create = mutation({
  args: { label: v.string(), kind: sessionKind, faultInjection: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    return insertSession(ctx, actor, args);
  },
});

/** Deterministic fixture seeding (tests, suite trials). No AI. */
export const seed = internalMutation({
  args: {
    label: v.string(),
    kind: sessionKind,
    faultInjection: v.boolean(),
    injectWriteFailure: v.optional(v.boolean()),
    currentShift: v.optional(v.number()),
    factory: v.object(factoryFields),
    jobs: v.array(seedJob),
  },
  handler: async (ctx, { jobs, factory, currentShift, ...args }) => {
    const sessionId = await insertSession(ctx, systemActor("seed"), args);
    if (currentShift !== undefined) await ctx.db.patch(sessionId, { currentShift });
    await ctx.db.insert("factory", { sessionId, ...factory });
    for (const job of jobs) await ctx.db.insert("jobs", { sessionId, ...job });
    return sessionId;
  },
});

/**
 * Seed a suite session from an rs-1.0 scenario. The oracle's witness is
 * verified by the guardrails first; seeding fails otherwise (SPEC §4).
 */
export const seedFromScenario = internalMutation({
  args: { scenarioId: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, { scenarioId, label }) => insertScenarioSession(ctx, scenarioId, label),
});

/** Seed one isolated suite session from an rs-1.0 scenario (shared with suite.start). */
export async function insertScenarioSession(
  ctx: MutationCtx,
  scenarioId: string,
  label?: string,
  kind: "suite" | "demo" = "suite",
  actor: Actor = systemActor("seed"),
) {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (scenario === undefined) throw new ConvexError({ code: "not_found", scenarioId });
  verifyScenario(scenario);
  const { snapshot } = scenario;
  const sessionId = await insertSession(ctx, actor, {
    label: label ?? `rs-1.0/${scenarioId}`,
    kind,
    faultInjection: false,
    injectWriteFailure: scenario.injectWriteFailure,
  });
  await ctx.db.patch(sessionId, { currentShift: snapshot.nowShift });
  await ctx.db.insert("factory", {
    sessionId,
    lines: snapshot.lines,
    orders: snapshot.orders,
    standardCycleTimes: snapshot.standardCycleTimes,
    mesObservations: snapshot.mesObservations,
    stock: snapshot.stock,
    arrivals: snapshot.arrivals,
    reservations: snapshot.reservations,
    dataAsOfShift: snapshot.dataAsOfShift,
  });
  for (const job of snapshot.frozenJobs) await ctx.db.insert("jobs", { sessionId, ...job, frozen: true });
  return sessionId;
}

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => ctx.db.get(sessionId),
});

/** qa creates a demo session seeded from a scenario. Demo sessions never allow fault injection. */
export const createDemo = mutation({
  args: { scenarioId: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, { scenarioId, label }) => {
    const actor = await requireRole(ctx, ["qa"]);
    return insertScenarioSession(ctx, scenarioId, label ?? `demo/${scenarioId}`, "demo", actor);
  },
});

/** Sessions a signed-in reviewer can work in (demo and replay). */
export const listForReview = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["planner", "qa"]);
    const all = await ctx.db.query("sessions").order("desc").take(200);
    return all.filter((s) => s.kind === "demo" || s.kind === "replay");
  },
});
