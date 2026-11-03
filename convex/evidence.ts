import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

// Public, read-only evidence for the recorded fault-injection replay
// (SPEC §12): refused action → reason → permission change → monitor window
// → reviews and outcomes → manifest diff. Only replay sessions are public.

const MAX_REVIEWS_SHOWN = 12;

/**
 * Which reviews from the signalling window to show in the viewer.
 * The window may hold dozens; the viewer shows at most MAX_REVIEWS_SHOWN.
 */
export function pickEvidenceReviews(reviews: readonly Doc<"reviews">[], max: number): Doc<"reviews">[] {
  // Edited reviews explain the signal, so they come first (with their
  // reasons); agreed ones follow so the ratio stays visible. Ties keep
  // the proposal order, so the list reads as a timeline.
  const edited = reviews.filter((r) => r.agreed === false);
  const agreed = reviews.filter((r) => r.agreed !== false);
  return [...edited, ...agreed].slice(0, max);
}

async function manifestSummary(ctx: QueryCtx, manifestHash: string) {
  const m = await ctx.db
    .query("manifests")
    .withIndex("by_hash", (q) => q.eq("manifestHash", manifestHash))
    .unique();
  return m && { operatorVersion: m.operatorVersion, manifestHash: m.manifestHash, model: m.model, effort: m.effort, dataView: m.dataView };
}

/** The latest replay session and its timeline, for the public results page. */
export const replayTimeline = query({
  args: {},
  handler: async (ctx) => {
    const session = (await ctx.db.query("sessions").order("desc").collect()).find((s) => s.kind === "replay");
    if (!session) return null;
    const sessionId = session._id;
    const changes = await ctx.db
      .query("permissionChanges")
      .withIndex("by_key", (q) => q.eq("sessionId", sessionId))
      .collect();
    const windows = await ctx.db
      .query("monitorWindows")
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();
    const reviews = await ctx.db
      .query("reviews")
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();
    const refused = (
      await ctx.db
        .query("actions")
        .withIndex("by_session_state", (q) => q.eq("sessionId", sessionId).eq("state", "refused"))
        .collect()
    ).filter((a) => a.refusalReason !== "superseded");
    const executed = await ctx.db
      .query("actions")
      .withIndex("by_session_state", (q) => q.eq("sessionId", sessionId).eq("state", "executed"))
      .collect();

    const byDay = new Map<number, { day: number; reviews: number; agreed: number; edited: number; manifestHashes: Set<string> }>();
    for (const r of reviews) {
      const d = byDay.get(r.proposalDay) ?? { day: r.proposalDay, reviews: 0, agreed: 0, edited: 0, manifestHashes: new Set<string>() };
      d.reviews++;
      if (r.agreed === true) d.agreed++;
      if (r.agreed === false) d.edited++;
      d.manifestHashes.add(r.manifestHash);
      byDay.set(r.proposalDay, d);
    }
    const manifests = await Promise.all([...new Set([...changes.map((c) => c.manifestHash), ...reviews.map((r) => r.manifestHash)])].map((h) => manifestSummary(ctx, h)));

    return {
      session: { sessionId, label: session.label, faultInjection: session.faultInjection, currentShift: session.currentShift, slotsPerDay: session.slotsPerDay ?? 2 },
      manifests: manifests.filter((m) => m !== null),
      permissionChanges: changes
        .sort((a, b) => a.changedAt - b.changedAt)
        .map((c) => ({ id: c._id, manifestHash: c.manifestHash, from: c.from, to: c.to, trigger: c.trigger, note: c.note ?? null, changedAt: c.changedAt })),
      windows: windows
        .sort((a, b) => a.manifestHash.localeCompare(b.manifestHash) || a.windowIndex - b.windowIndex)
        .map((w) => ({ id: w._id, manifestHash: w.manifestHash, windowIndex: w.windowIndex, startDay: w.startDay, endDay: w.endDay, evaluatedOnDay: w.evaluatedOnDay, status: w.status, n: w.n, x: w.x, pending: w.pending, pValue: w.pValue ?? null, p0: w.p0, alpha: w.alpha })),
      days: [...byDay.values()].sort((a, b) => a.day - b.day).map((d) => ({ ...d, manifestHashes: [...d.manifestHashes] })),
      executedCount: executed.length,
      refusedActionIds: refused.map((a) => a._id),
    };
  },
});

/** Evidence chain for one refused action in the replay. */
export const forAction = query({
  args: { actionId: v.id("actions") },
  handler: async (ctx, { actionId }) => {
    const action = await ctx.db.get(actionId);
    if (!action) return null;
    const session = await ctx.db.get(action.sessionId);
    if (!session || session.kind !== "replay") return null;

    const execution = await ctx.db
      .query("executions")
      .withIndex("by_action", (q) => q.eq("actionId", actionId))
      .unique();
    const jobsAfter = await ctx.db
      .query("jobs")
      .withIndex("by_session", (q) => q.eq("sessionId", action.sessionId))
      .collect();
    const revision = await ctx.db.get(action.proposalRevisionId);

    // Resolve the evidence ids recorded on the refusal.
    // normalizeId returns null for ids of other tables, so each lookup only
    // matches the record type it expects.
    let change: Doc<"permissionChanges"> | null = null;
    for (const raw of execution?.evidenceIds ?? []) {
      const id = ctx.db.normalizeId("permissionChanges", raw);
      if (id) change = await ctx.db.get(id);
    }
    let window: Doc<"monitorWindows"> | null = null;
    for (const raw of change?.evidenceIds ?? []) {
      const id = ctx.db.normalizeId("monitorWindows", raw);
      if (id) window = await ctx.db.get(id);
    }
    const windowReviews = window ? (await Promise.all(window.reviewIds.map((id) => ctx.db.get(id)))).filter((r): r is Doc<"reviews"> => r !== null) : [];
    const shown = pickEvidenceReviews(windowReviews, MAX_REVIEWS_SHOWN);

    const [refusedManifest, otherManifests] = await Promise.all([
      manifestSummary(ctx, action.manifestHash),
      ctx.db.query("manifests").collect(),
    ]);
    const fix = otherManifests.find((m) => m.operatorVersion === "op-v2" && m.suiteVersion === "rs-1.0" && m.model === refusedManifest?.model);

    return {
      label: "Fault-injection replay. Synthetic factory and synthetic reviewer.",
      action: { actionId, state: action.state, refusalReason: action.refusalReason ?? null, queuedUnder: action.queuedUnder, dueShift: action.dueShift },
      execution: execution && {
        result: execution.result,
        stateVersionBefore: execution.stateVersionBefore,
        stateVersionAfter: execution.stateVersionAfter,
        executed: execution.result === "executed",
        executedAt: execution.executedAt,
      },
      plannedJobs: revision?.schedule ?? [],
      jobsInFactoryAfter: jobsAfter.filter((j) => !j.frozen).length,
      permissionChange: change && { id: change._id, from: change.from, to: change.to, trigger: change.trigger, note: change.note ?? null, changedAt: change.changedAt },
      window: window && { id: window._id, windowIndex: window.windowIndex, startDay: window.startDay, endDay: window.endDay, evaluatedOnDay: window.evaluatedOnDay, status: window.status, n: window.n, x: window.x, pending: window.pending, pValue: window.pValue ?? null, p0: window.p0, alpha: window.alpha },
      reviews: {
        total: windowReviews.length,
        shown: shown.map((r) => ({ id: r._id, proposalDay: r.proposalDay, agreed: r.agreed, reasons: r.reasons, mode: r.mode })),
      },
      manifestDiff: refusedManifest && fix ? { refused: refusedManifest, fix: { operatorVersion: fix.operatorVersion, manifestHash: fix.manifestHash, model: fix.model, effort: fix.effort, dataView: fix.dataView } } : null,
    };
  },
});
