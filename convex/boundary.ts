import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor } from "./auth";
import { getSession, writeAudit } from "./lib/records";
import { dayOf, evaluateDueWindows } from "./monitor";

// shiftBoundary (SPEC §9.6), three ordered steps:
//   1. close the previous monitoring period (advance the clock)
//   2. evaluate the rule and COMMIT any demotion
//   3. then release the queue (executeAction for each due action)
// Each step is its own mutation and marks itself done on a boundaryRuns
// row, so a retried boundary resumes where it stopped. Step 3 calls the
// idempotent executeAction, so a retry after a lost acknowledgement can't
// execute twice. Because step 2 commits before step 3 starts, an action
// released after a committed demotion is refused.
//
// Deviation from SPEC §2: this runs as a Convex action, not an Inngest
// function (see plan.md, step 7). The ordering and idempotency guarantees
// above are the same.

async function runRow(ctx: MutationCtx, sessionId: Id<"sessions">, toShift: number) {
  const row = await ctx.db
    .query("boundaryRuns")
    .withIndex("by_session_shift", (q) => q.eq("sessionId", sessionId).eq("toShift", toShift))
    .unique();
  if (row) return row;
  const id = await ctx.db.insert("boundaryRuns", {
    sessionId,
    toShift,
    closed: false,
    evaluated: false,
    released: false,
    demotionIds: [],
    executedActionIds: [],
  });
  return (await ctx.db.get(id))!;
}

/** Step 1. */
export const closePeriod = internalMutation({
  args: { sessionId: v.id("sessions"), toShift: v.number() },
  handler: async (ctx, { sessionId, toShift }) => {
    const row = await runRow(ctx, sessionId, toShift);
    if (row.closed) return;
    const session = await getSession(ctx, sessionId);
    if (session.currentShift !== toShift - 1) {
      throw new ConvexError({ code: "invariant", message: `boundary to ${toShift} but clock is at ${session.currentShift}` });
    }
    await ctx.db.patch(sessionId, { currentShift: toShift });
    await ctx.db.patch(row._id, { closed: true });
    await writeAudit(ctx, { sessionId, kind: "boundary.closed", actor: systemActor("shiftBoundary"), refs: [row._id], detail: `shift ${toShift}` });
  },
});

/** Step 2: evaluate the monitoring rule for every manifest with reviews here; commit any demotion. */
export const evaluateRule = internalMutation({
  args: { sessionId: v.id("sessions"), toShift: v.number() },
  handler: async (ctx, { sessionId, toShift }) => {
    const row = await runRow(ctx, sessionId, toShift);
    if (!row.closed) throw new ConvexError({ code: "invariant", message: "step 1 has not run" });
    if (row.evaluated) return row.demotionIds;
    const session = await getSession(ctx, sessionId);
    const today = dayOf(session, toShift);
    const reviews = await ctx.db
      .query("reviews")
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();
    const demotionIds: Id<"permissionChanges">[] = [];
    for (const manifestHash of new Set(reviews.map((r) => r.manifestHash))) {
      const d = await evaluateDueWindows(ctx, sessionId, manifestHash, today);
      if (d) demotionIds.push(d);
    }
    await ctx.db.patch(row._id, { evaluated: true, demotionIds });
    return demotionIds;
  },
});

export const dueActions = internalQuery({
  args: { sessionId: v.id("sessions"), toShift: v.number() },
  handler: async (ctx, { sessionId, toShift }) =>
    (
      await ctx.db
        .query("actions")
        .withIndex("by_session_state", (q) => q.eq("sessionId", sessionId).eq("state", "queued"))
        .collect()
    )
      .filter((a) => a.dueShift <= toShift)
      .sort((a, b) => a.queuedAt - b.queuedAt)
      .map((a) => a._id),
});

export const markReleased = internalMutation({
  args: { sessionId: v.id("sessions"), toShift: v.number(), executedActionIds: v.array(v.id("actions")) },
  handler: async (ctx, { sessionId, toShift, executedActionIds }) => {
    const row = await runRow(ctx, sessionId, toShift);
    if (!row.evaluated) throw new ConvexError({ code: "invariant", message: "step 2 has not run" });
    await ctx.db.patch(row._id, { released: true, executedActionIds: [...row.executedActionIds, ...executedActionIds] });
  },
});

export const pendingRun = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await getSession(ctx, sessionId);
    const open = await ctx.db
      .query("boundaryRuns")
      .withIndex("by_session_shift", (q) => q.eq("sessionId", sessionId))
      .filter((q) => q.eq(q.field("released"), false))
      .first();
    return { currentShift: session.currentShift, openToShift: open?.toShift ?? null };
  },
});

export type BoundaryResult = {
  toShift: number;
  demotionIds: Id<"permissionChanges">[];
  outcomes: { actionId: Id<"actions">; result: string; refusalReason?: string }[];
};

/** Run (or resume) the next shift boundary for a session. */
export const run = internalAction({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }): Promise<BoundaryResult> => {
    const { currentShift, openToShift } = await ctx.runQuery(internal.boundary.pendingRun, { sessionId });
    const toShift = openToShift ?? currentShift + 1;
    await ctx.runMutation(internal.boundary.closePeriod, { sessionId, toShift });
    const demotionIds = await ctx.runMutation(internal.boundary.evaluateRule, { sessionId, toShift });
    const due = await ctx.runQuery(internal.boundary.dueActions, { sessionId, toShift });
    const outcomes: BoundaryResult["outcomes"] = [];
    for (const actionId of due) {
      const out = await ctx.runMutation(internal.execute.executeAction, { sessionId, actionId });
      outcomes.push({ actionId, result: out.result, refusalReason: out.refusalReason });
    }
    await ctx.runMutation(internal.boundary.markReleased, { sessionId, toShift, executedActionIds: due });
    return { toShift, demotionIds, outcomes };
  },
});

/** qa advances the simulated clock by one shift in a demo or replay session. */
export const advance = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const actor = await requireRole(ctx, ["qa"]);
    const session = await getSession(ctx, sessionId);
    if (session.kind === "suite") throw new ConvexError({ code: "invalid", message: "suite sessions don't advance" });
    await ctx.scheduler.runAfter(0, internal.boundary.run, { sessionId });
    await writeAudit(ctx, { sessionId, kind: "boundary.requested", actor, refs: [] });
    return null;
  },
});
