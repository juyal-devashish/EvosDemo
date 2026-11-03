import { runGuardrails, type GuardrailResult } from "../../checks/guardrails";
import { HORIZON_HOURS, type ScheduledJob } from "../../sim/domain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Plan } from "./validators";

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

/** Run G1–G8 for a plan against the session's current factory state. */
export async function checkPlan(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  proposal: Pick<Doc<"proposals">, "scope">,
  plan: Pick<Plan, "schedule">,
): Promise<GuardrailResult> {
  const { frozen } = await loadJobs(ctx, sessionId);
  return runGuardrails({
    grantedScope: "scheduling",
    proposalScope: proposal.scope,
    horizonHours: HORIZON_HOURS,
    frozenJobs: frozen.map(toJob),
    schedule: plan.schedule,
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
 * touched (G1 already refuses revisions that try to move them).
 */
export async function applyDiff(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  movable: readonly Doc<"jobs">[],
  diff: ReturnType<typeof scheduleDiff>,
) {
  const removedKeys = new Set(diff.removed.map(key));
  for (const row of movable) {
    if (removedKeys.has(key(toJob(row)))) await ctx.db.delete(row._id);
  }
  for (const job of diff.added) {
    await ctx.db.insert("jobs", { sessionId, ...job, frozen: false });
  }
}

export { toJob };
