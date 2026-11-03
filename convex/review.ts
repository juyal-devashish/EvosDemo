import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRole } from "./auth";
import { currentPermission, getSession } from "./lib/records";

// Review panel data (SPEC §12), for planner and qa. Read-only; the actions
// it offers are the role-checked mutations in queue.ts, proposals.ts,
// permissions.ts and operator.ts.

export const session = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const viewer = await requireRole(ctx, ["planner", "qa"]);
    const session = await getSession(ctx, sessionId);
    const factory = await ctx.db
      .query("factory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .unique();
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();

    const manifests = await ctx.db.query("manifests").collect();
    // Only the current release pair (those with a finished suite run), newest first.
    const runs = await ctx.db.query("suiteRuns").order("desc").collect();
    const verdictByHash = new Map<string, string>();
    for (const r of runs) if (r.verdict && !verdictByHash.has(r.manifestHash)) verdictByHash.set(r.manifestHash, r.verdict.text);
    const releases = [];
    for (const m of manifests.filter((x) => verdictByHash.has(x.manifestHash))) {
      const { level, row } = await currentPermission(ctx, { sessionId, manifestHash: m.manifestHash, scope: "scheduling" });
      releases.push({
        manifestHash: m.manifestHash,
        operatorVersion: m.operatorVersion,
        level,
        viaFaultInjection: row?.viaFaultInjection ?? false,
        suiteVerdict: verdictByHash.get(m.manifestHash)!,
      });
    }
    releases.sort((a, b) => a.operatorVersion.localeCompare(b.operatorVersion));

    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .order("desc")
      .take(20);
    const detailed = [];
    for (const p of proposals) {
      const revision = p.latestRevisionId ? await ctx.db.get(p.latestRevisionId) : null;
      if (revision === null) continue;
      const approvals = await ctx.db
        .query("approvals")
        .withIndex("by_revision", (q) => q.eq("proposalRevisionId", revision._id))
        .collect();
      const actions = (
        await ctx.db
          .query("actions")
          .withIndex("by_session_state", (q) => q.eq("sessionId", sessionId))
          .collect()
      ).filter((a) => a.proposalRevisionId === revision._id);
      const manifest = manifests.find((m) => m.manifestHash === p.manifestHash);
      detailed.push({
        proposalId: p._id,
        operatorVersion: manifest?.operatorVersion ?? "unknown",
        manifestHash: p.manifestHash,
        trigger: p.trigger,
        shift: p.shift,
        provenance: p.provenance ?? null,
        revision: {
          revisionId: revision._id,
          revisionNumber: revision.revisionNumber,
          author: revision.author,
          baseStateVersion: revision.baseStateVersion,
          check: revision.proposalTimeCheck,
          schedule: revision.schedule,
          dispositions: revision.dispositions,
          escalations: revision.escalations,
          summary: revision.summary,
        },
        approvals: approvals.map((a) => ({ approvalId: a._id, actor: a.actor, decidedAt: a.decidedAt })),
        actions: actions.map((a) => ({ actionId: a._id, state: a.state, refusalReason: a.refusalReason ?? null, dueShift: a.dueShift })),
      });
    }

    const pendingAttempts = (
      await ctx.db
        .query("attempts")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect()
    ).filter((a) => a.status === "pending").length;

    return {
      viewer: { role: viewer.kind === "user" ? viewer.role : null },
      session: {
        sessionId: session._id,
        label: session.label,
        kind: session.kind,
        faultInjection: session.faultInjection,
        currentShift: session.currentShift,
        stateVersion: session.stateVersion,
      },
      orders: factory?.orders ?? [],
      jobs: jobs
        .map((j) => ({ orderId: j.orderId, lineId: j.lineId, startHour: j.startHour, endHour: j.endHour, frozen: j.frozen }))
        .sort((a, b) => a.lineId.localeCompare(b.lineId) || a.startHour - b.startHour),
      releases,
      proposals: detailed,
      pendingAttempts,
    };
  },
});
