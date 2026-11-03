import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { currentPermission, effectiveLevel, getInSession, getSession, writeAudit } from "./lib/records";

// Actions are queued for the next shift boundary, where `shiftBoundary`
// releases them through `executeAction` (SPEC §9.6). At most one queued
// revision per scope per shift: a newer one supersedes the queued one (§9.2).

async function loadLatestRevision(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  revisionId: Id<"proposalRevisions">,
) {
  const revision = await getInSession(ctx, sessionId, revisionId);
  const proposal = await getInSession(ctx, sessionId, revision.proposalId);
  if (proposal.latestRevisionId !== revision._id) {
    throw new ConvexError({ code: "not_latest_revision", latest: proposal.latestRevisionId });
  }
  if (!revision.proposalTimeCheck.ok) {
    // Guardrail failures can't be overridden by approval, only corrected (§7).
    throw new ConvexError({ code: "guardrail_failed", failures: revision.proposalTimeCheck.failures });
  }
  return { revision, proposal };
}

export async function enqueue(
  ctx: MutationCtx,
  args: {
    session: Doc<"sessions">;
    proposal: Doc<"proposals">;
    revisionId: Id<"proposalRevisions">;
    queuedUnder: "supervised" | "limited";
    approvalId?: Id<"approvals">;
    actor: Actor;
  },
) {
  const sessionId = args.session._id;
  const dueShift = args.session.currentShift + 1;
  const now = Date.now();

  const queued = await ctx.db
    .query("actions")
    .withIndex("by_session_scope_shift", (q) =>
      q.eq("sessionId", sessionId).eq("scope", args.proposal.scope).eq("dueShift", dueShift).eq("state", "queued"),
    )
    .collect();

  const actionId = await ctx.db.insert("actions", {
    sessionId,
    proposalRevisionId: args.revisionId,
    manifestHash: args.proposal.manifestHash,
    scope: args.proposal.scope,
    dueShift,
    queuedUnder: args.queuedUnder,
    approvalId: args.approvalId,
    state: "queued",
    queuedAt: now,
  });

  for (const old of queued) {
    await ctx.db.patch(old._id, { state: "refused", refusalReason: "superseded" });
    await ctx.db.insert("executions", {
      sessionId,
      actionId: old._id,
      result: "refused",
      refusalReason: "superseded",
      guardrailFailures: [],
      evidenceIds: [actionId],
      stateVersionBefore: args.session.stateVersion,
      stateVersionAfter: args.session.stateVersion,
      executedAt: now,
    });
    await writeAudit(ctx, {
      sessionId,
      kind: "action.refused",
      actor: args.actor,
      refs: [old._id, actionId],
      detail: "superseded",
    });
  }
  await writeAudit(ctx, { sessionId, kind: "action.queued", actor: args.actor, refs: [actionId, args.revisionId] });
  return actionId;
}

/**
 * A reviewer approves the latest revision and queues it. Approval binds to
 * this revision, this manifest and the current factory stateVersion. An
 * approval doesn't grant execution: shadow still never executes (§9.4).
 */
export const approve = mutation({
  args: { sessionId: v.id("sessions"), revisionId: v.id("proposalRevisions") },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["planner", "qa"]);
    const session = await getSession(ctx, args.sessionId);
    const { revision, proposal } = await loadLatestRevision(ctx, args.sessionId, args.revisionId);
    const approvalId = await ctx.db.insert("approvals", {
      sessionId: args.sessionId,
      proposalRevisionId: revision._id,
      baseStateVersion: session.stateVersion,
      actor,
      manifestHash: proposal.manifestHash,
      decidedAt: Date.now(),
    });
    await writeAudit(ctx, { sessionId: args.sessionId, kind: "approval.recorded", actor, refs: [approvalId, revision._id] });
    const actionId = await enqueue(ctx, {
      session,
      proposal,
      revisionId: revision._id,
      queuedUnder: "supervised",
      approvalId,
      actor,
    });
    return { approvalId, actionId };
  },
});

/** Limited autonomy: the operator's revision is queued without approval. */
export const queueAutonomous = internalMutation({
  args: { sessionId: v.id("sessions"), revisionId: v.id("proposalRevisions") },
  handler: async (ctx, args) => {
    const session = await getSession(ctx, args.sessionId);
    const { revision, proposal } = await loadLatestRevision(ctx, args.sessionId, args.revisionId);
    const { level } = await currentPermission(ctx, {
      sessionId: args.sessionId,
      manifestHash: proposal.manifestHash,
      scope: proposal.scope,
    });
    if (effectiveLevel(level) !== "limited") return null;
    return enqueue(ctx, {
      session,
      proposal,
      revisionId: revision._id,
      queuedUnder: "limited",
      actor: systemActor(`operator:${proposal.manifestHash}`),
    });
  },
});

/**
 * Approval by a named system reviewer (the labeled synthetic reviewer in
 * the replay's supervised recovery phase). Same binding rules as approve.
 */
export const approveAsSystem = internalMutation({
  args: { sessionId: v.id("sessions"), revisionId: v.id("proposalRevisions"), reviewer: v.string() },
  handler: async (ctx, args) => {
    const actor = systemActor(args.reviewer);
    const session = await getSession(ctx, args.sessionId);
    const { revision, proposal } = await loadLatestRevision(ctx, args.sessionId, args.revisionId);
    const approvalId = await ctx.db.insert("approvals", {
      sessionId: args.sessionId,
      proposalRevisionId: revision._id,
      baseStateVersion: session.stateVersion,
      actor,
      manifestHash: proposal.manifestHash,
      decidedAt: Date.now(),
    });
    await writeAudit(ctx, { sessionId: args.sessionId, kind: "approval.recorded", actor, refs: [approvalId, revision._id] });
    const actionId = await enqueue(ctx, { session, proposal, revisionId: revision._id, queuedUnder: "supervised", approvalId, actor });
    return { approvalId, actionId };
  },
});
