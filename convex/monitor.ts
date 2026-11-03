import { v } from "convex/values";
import { MONITOR_CONFIG as C } from "../stats/config";
import { evaluateWindow } from "../stats/rule";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { systemActor } from "./auth";
import { currentPermission, effectiveLevel, getSession, writeAudit } from "./lib/records";
import { setLevel } from "./permissions";

// The production monitor (SPEC §10.4) inside Convex. The rule itself is
// the pure stats/rule.ts with the frozen stats/config.ts. A signal is the
// only automatic autonomy trigger: it demotes limited → demoted.

const DEFAULT_SLOTS_PER_DAY = 2;

export const slotsPerDay = (s: Pick<Doc<"sessions">, "slotsPerDay">) => s.slotsPerDay ?? DEFAULT_SLOTS_PER_DAY;

/** 1-based simulated day of a shift (decision slot). */
export const dayOf = (s: Pick<Doc<"sessions">, "slotsPerDay">, shift: number) => Math.floor(shift / slotsPerDay(s)) + 1;

export async function recordReview(
  ctx: MutationCtx,
  r: Omit<Doc<"reviews">, "_id" | "_creationTime" | "reviewer" | "jobType">,
): Promise<Id<"reviews">> {
  const id = await ctx.db.insert("reviews", { ...r, reviewer: "synthetic", jobType: "routine" });
  await writeAudit(ctx, {
    sessionId: r.sessionId,
    kind: "review.recorded",
    actor: systemActor("synthetic_reviewer"),
    refs: [id, r.proposalRevisionId],
    detail: r.agreed === null ? "pending" : r.agreed ? "agreed" : "edited",
  });
  return id;
}

/** Internal entry point for recording a synthetic review (replay driver, tests). */
export const addReview = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    proposalRevisionId: v.id("proposalRevisions"),
    actionId: v.optional(v.id("actions")),
    mode: v.union(v.literal("supervised"), v.literal("post_execution")),
    proposalDay: v.number(),
    agreed: v.union(v.boolean(), v.null()),
    shouldEdit: v.boolean(),
    reasons: v.array(v.string()),
    reviewedOnDay: v.optional(v.number()),
  },
  handler: (ctx, args) => recordReview(ctx, args),
});

/**
 * Evaluate every window of post-execution reviews that is due on `today`:
 * closed, and either all reviews in or `graceDays` past its close. Each
 * window is evaluated once. The first signal demotes a limited manifest.
 * Returns the demotion's permission-change id, if any.
 */
export async function evaluateDueWindows(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  manifestHash: string,
  today: number,
): Promise<Id<"permissionChanges"> | null> {
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_session_manifest", (q) => q.eq("sessionId", sessionId).eq("manifestHash", manifestHash))
    .collect();
  const monitored = reviews.filter((r) => r.mode === "post_execution" && r.jobType === "routine");
  const done = await ctx.db
    .query("monitorWindows")
    .withIndex("by_session_manifest", (q) => q.eq("sessionId", sessionId).eq("manifestHash", manifestHash))
    .collect();
  const evaluated = new Set(done.map((w) => w.windowIndex));
  const windows = [...new Set(monitored.map((r) => Math.floor((r.proposalDay - 1) / C.windowDays)))].sort((a, b) => a - b);

  for (const w of windows) {
    if (evaluated.has(w)) continue;
    const startDay = w * C.windowDays + 1;
    const endDay = (w + 1) * C.windowDays;
    if (today <= endDay) continue; // not closed yet
    const inWindow = monitored.filter((r) => r.proposalDay >= startDay && r.proposalDay <= endDay);
    const pendingNow = inWindow.filter((r) => r.agreed === null || (r.reviewedOnDay ?? Infinity) > today);
    const graceOver = today > endDay + C.graceDays;
    if (pendingNow.length > 0 && !graceOver) continue; // wait for reviews, up to the grace period

    const result = evaluateWindow(
      inWindow.map((r) =>
        r.agreed === null || (r.reviewedOnDay ?? Infinity) > today ? { pending: true as const } : { agreed: r.agreed },
      ),
      C,
    );
    const windowId = await ctx.db.insert("monitorWindows", {
      sessionId,
      manifestHash,
      windowIndex: w,
      startDay,
      endDay,
      evaluatedOnDay: today,
      status: result.status,
      n: result.n,
      x: result.x,
      pending: result.pending,
      pValue: result.status === "insufficientData" ? undefined : result.pValue,
      p0: C.p0,
      alpha: C.alpha,
      reviewIds: inWindow.map((r) => r._id),
    });
    await writeAudit(ctx, {
      sessionId,
      kind: `monitor.window_${result.status}`,
      actor: systemActor("monitor"),
      refs: [windowId],
      detail: `days ${startDay}–${endDay}: ${result.x}/${result.n} agreed, ${result.pending} pending`,
    });
    if (result.status === "signal") {
      const key = { sessionId, manifestHash, scope: "scheduling" as const };
      const { level } = await currentPermission(ctx, key);
      if (effectiveLevel(level) === "limited") {
        return setLevel(ctx, key, {
          to: "demoted",
          trigger: "monitor_signal",
          actor: systemActor("monitor"),
          evidenceIds: [windowId],
          note: `review agreement ${result.x}/${result.n} (synthetic reviewer) below p0 ${C.p0} at α ${C.alpha}`,
        });
      }
    }
  }
  return null;
}

/** Public, read-only: monitor windows and reviews for a session (results page, evidence viewer). */
export const sessionMonitor = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx: QueryCtx, { sessionId }) => {
    const session = await getSession(ctx, sessionId);
    // Only the recorded replay is public; demo sessions are for signed-in reviewers.
    if (session.kind !== "replay") return null;
    const windows = await ctx.db
      .query("monitorWindows")
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();
    const reviews = await ctx.db
      .query("reviews")
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();
    return { session: { label: session.label, kind: session.kind, faultInjection: session.faultInjection }, windows, reviews };
  },
});
