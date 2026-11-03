import { ConvexError, v } from "convex/values";
import { GUARDRAIL_VERSION } from "../checks/guardrails";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { checkPlan } from "./lib/factory";
import { getInSession, getSession, writeAudit } from "./lib/records";
import { plan, planObject, type Plan } from "./lib/validators";

// One decision = one proposal = one whole-schedule revision for one trigger
// (SPEC §9.2). Revisions are immutable: an edit creates a new revision, and
// approvals of earlier revisions don't carry over (§9.3).

async function insertRevision(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"sessions">;
    proposalId: Id<"proposals">;
    revisionNumber: number;
    parentRevisionId?: Id<"proposalRevisions">;
    author: Actor;
    plan: Plan;
  },
) {
  const session = await getSession(ctx, args.sessionId);
  const proposal = await getInSession(ctx, args.sessionId, args.proposalId);
  const check = await checkPlan(ctx, args.sessionId, proposal, args.plan);
  const revisionId = await ctx.db.insert("proposalRevisions", {
    sessionId: args.sessionId,
    proposalId: args.proposalId,
    revisionNumber: args.revisionNumber,
    parentRevisionId: args.parentRevisionId,
    author: args.author,
    baseStateVersion: session.stateVersion,
    proposalTimeCheck: { ok: check.ok, failures: check.failures, guardrailVersion: GUARDRAIL_VERSION },
    ...args.plan,
  });
  await ctx.db.patch(args.proposalId, {
    latestRevisionId: revisionId,
    revisionCount: args.revisionNumber,
  });
  await writeAudit(ctx, {
    sessionId: args.sessionId,
    kind: args.revisionNumber === 1 ? "proposal.created" : "proposal.edited",
    actor: args.author,
    refs: [args.proposalId, revisionId],
  });
  return revisionId;
}

/** Operator output lands here (server-side only; step 3 wires the model call). */
export const create = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    trigger: v.string(),
    ...plan,
  },
  handler: async (ctx, { sessionId, manifestHash, trigger, ...body }) => {
    const session = await getSession(ctx, sessionId);
    const manifest = await ctx.db
      .query("manifests")
      .withIndex("by_hash", (q) => q.eq("manifestHash", manifestHash))
      .unique();
    if (manifest === null) throw new ConvexError({ code: "not_found", manifestHash });
    const proposalId = await ctx.db.insert("proposals", {
      sessionId,
      manifestHash,
      scope: manifest.scope,
      trigger,
      shift: session.currentShift,
      revisionCount: 0,
    });
    const revisionId = await insertRevision(ctx, {
      sessionId,
      proposalId,
      revisionNumber: 1,
      author: systemActor(`operator:${manifest.operatorVersion}`),
      plan: body,
    });
    return { proposalId, revisionId };
  },
});

/** A reviewer edits the latest revision. Earlier approvals don't apply to the result. */
export const edit = mutation({
  args: { sessionId: v.id("sessions"), revisionId: v.id("proposalRevisions"), plan: planObject },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["planner", "qa"]);
    const revision = await getInSession(ctx, args.sessionId, args.revisionId);
    const proposal = await getInSession(ctx, args.sessionId, revision.proposalId);
    if (proposal.latestRevisionId !== revision._id) {
      throw new ConvexError({ code: "not_latest_revision", latest: proposal.latestRevisionId });
    }
    return insertRevision(ctx, {
      sessionId: args.sessionId,
      proposalId: proposal._id,
      revisionNumber: proposal.revisionCount + 1,
      parentRevisionId: revision._id,
      author: actor,
      plan: args.plan,
    });
  },
});
