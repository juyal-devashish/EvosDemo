import { ConvexError } from "convex/values";
import { runGuardrails, type GuardrailResult } from "../../checks/guardrails";
import { HORIZON_HOURS, type FactorySnapshot, type Plan, type ScheduledJob } from "../../sim/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const toJob = (j: Doc<"jobs">): ScheduledJob => ({
  orderId: j.orderId,
  lineId: j.lineId,
  startHour: j.startHour,
  endHour: j.endHour,
});

export async function loadJobs(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const rows = await ctx.db
    .query("jobs")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  return { frozen: rows.filter((r) => r.frozen), movable: rows.filter((r) => !r.frozen) };
}

async function loadFactory(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const factory = await ctx.db
    .query("factory")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
  if (factory === null) throw new ConvexError({ code: "not_found", message: "session has no factory data", sessionId });
  return factory;
}

/** The session's current factory state as the pure checks see it. Ages come from the server clock. */
export async function loadSnapshot(ctx: QueryCtx, sessionId: Id<"sessions">): Promise<FactorySnapshot> {
  const session = await ctx.db.get(sessionId);
  if (session === null) throw new ConvexError({ code: "not_found", id: sessionId });
  const f = await loadFactory(ctx, sessionId);
  const { frozen } = await loadJobs(ctx, sessionId);
  return {
    lines: f.lines,
    orders: f.orders,
    standardCycleTimes: f.standardCycleTimes,
    mesObservations: f.mesObservations,
    stock: f.stock,
    arrivals: f.arrivals,
    reservations: f.reservations,
    dataAsOfShift: f.dataAsOfShift,
    nowShift: session.currentShift,
    horizonHours: HORIZON_HOURS,
    frozenJobs: frozen.map((j) => ({ ...toJob(j), partFamily: j.partFamily })),
  };
}

/** Run G1–G8 for a plan against the session's current factory state, under the proposal's manifest. */
export async function checkPlan(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  proposal: Pick<Doc<"proposals">, "scope" | "manifestHash">,
  plan: Pick<Plan, "schedule" | "dispositions">,
): Promise<GuardrailResult> {
  const manifest = await ctx.db
    .query("manifests")
    .withIndex("by_hash", (q) => q.eq("manifestHash", proposal.manifestHash))
    .unique();
  if (manifest === null) throw new ConvexError({ code: "not_found", manifestHash: proposal.manifestHash });
  return runGuardrails({
    grantedScope: "scheduling",
    proposalScope: proposal.scope,
    snapshot: await loadSnapshot(ctx, sessionId),
    plan,
    dataView: manifest.dataView,
  });
}

const key = (j: ScheduledJob) => `${j.orderId}|${j.lineId}|${j.startHour}|${j.endHour}`;

/** Diff from the current movable jobs to the revision's whole schedule. */
export function scheduleDiff(current: readonly ScheduledJob[], target: readonly ScheduledJob[]) {
  const currentKeys = new Set(current.map(key));
  const targetKeys = new Set(target.map(key));
  return {
    added: target.filter((j) => !currentKeys.has(key(j))),
    removed: current.filter((j) => !targetKeys.has(key(j))),
  };
}

/**
 * Write exactly `diff` to the session's movable jobs. Frozen jobs are never
 * touched (G1 refuses revisions that try to move them).
 */
export async function applyDiff(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  movable: readonly Doc<"jobs">[],
  diff: ReturnType<typeof scheduleDiff>,
) {
  const factory = await loadFactory(ctx, sessionId);
  const familyOf = new Map(factory.orders.map((o) => [o.orderId, o.partFamily]));
  const removedKeys = new Set(diff.removed.map(key));
  for (const row of movable) {
    if (removedKeys.has(key(toJob(row)))) await ctx.db.delete(row._id);
  }
  for (const job of diff.added) {
    const partFamily = familyOf.get(job.orderId);
    // G6 already refused orders outside the open set; this is an invariant.
    if (partFamily === undefined) throw new ConvexError({ code: "invariant", message: `unknown order ${job.orderId}` });
    await ctx.db.insert("jobs", { sessionId, ...job, partFamily, frozen: false });
  }
}

export { toJob };
