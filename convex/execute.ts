import { ConvexError, v } from "convex/values";
import type { GuardrailFailure } from "../checks/guardrails";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { systemActor } from "./auth";
import { applyDiff, checkPlan, loadJobs, scheduleDiff, toJob } from "./lib/factory";
import { currentPermission, effectiveLevel, getInSession, getSession, writeAudit } from "./lib/records";
import type { ExecutionResult, RefusalReason } from "./lib/validators";

// executeAction (SPEC §9.5): one Convex mutation, so one transaction.
//
// Guarantee: an execution that commits before a demotion commits may
// execute; one ordered after a committed demotion is refused. Convex
// serializes mutations that touch the same permission row, so the
// permission read below always sees every demotion committed before it.
//
// Refusals RETURN normally. Throwing would roll back the refusal record.

export type ExecuteOutcome = {
  executionId: Id<"executions">;
  result: ExecutionResult;
  refusalReason?: RefusalReason;
  /** True when this call returned an earlier stored result (retry, lost ack). */
  deduplicated: boolean;
};

type Decision =
  | { kind: "refuse"; reason: RefusalReason; evidenceIds: string[]; failures?: GuardrailFailure[] }
  | { kind: "proceed"; evidenceIds: string[] };

/** Steps 1–2: read the current permission, validate approval or limited grant, and the revision. */
async function authorize(
  ctx: MutationCtx,
  action: Doc<"actions">,
  proposal: Doc<"proposals">,
): Promise<Decision> {
  const { level, row } = await currentPermission(ctx, {
    sessionId: action.sessionId,
    manifestHash: action.manifestHash,
    scope: action.scope,
  });
  const permissionEvidence = row ? [row.lastChangeId] : [];
  const effective = effectiveLevel(level);

  if (effective === "shadow") {
    return { kind: "refuse", reason: "shadow_never_executes", evidenceIds: permissionEvidence };
  }
  if (proposal.latestRevisionId !== action.proposalRevisionId) {
    return {
      kind: "refuse",
      reason: "revision_superseded",
      evidenceIds: proposal.latestRevisionId ? [proposal.latestRevisionId] : [],
    };
  }
  if (effective === "limited") {
    return { kind: "proceed", evidenceIds: permissionEvidence };
  }

  // Supervised (or demoted, which grants the same): needs an approval of
  // exactly this revision under exactly this manifest.
  if (action.approvalId === undefined) {
    // Queued under limited autonomy, but the permission no longer allows it.
    return { kind: "refuse", reason: "not_permitted", evidenceIds: permissionEvidence };
  }
  const approval = await ctx.db.get(action.approvalId);
  if (approval === null || approval.proposalRevisionId !== action.proposalRevisionId) {
    return { kind: "refuse", reason: "no_valid_approval", evidenceIds: [action.approvalId] };
  }
  if (approval.manifestHash !== action.manifestHash) {
    return { kind: "refuse", reason: "manifest_mismatch", evidenceIds: [approval._id] };
  }
  return { kind: "proceed", evidenceIds: [...permissionEvidence, approval._id] };
}

export const executeAction = internalMutation({
  args: { sessionId: v.id("sessions"), actionId: v.id("actions") },
  handler: (ctx, args): Promise<ExecuteOutcome> => executeActionInTransaction(ctx, args),
});

/**
 * The body of executeAction, for callers that are already inside a
 * mutation (the suite harness). Same transaction as the caller.
 */
export async function executeActionInTransaction(
  ctx: MutationCtx,
  { sessionId, actionId }: { sessionId: Id<"sessions">; actionId: Id<"actions"> },
): Promise<ExecuteOutcome> {
  const actor = systemActor("executeAction");
  const action = await getInSession(ctx, sessionId, actionId);

  // Step 3, checked first: a retry returns the stored result, whatever
  // has changed since. Checking it after steps 1–2 could report a refusal
  // for an action that already executed.
  const prior = await ctx.db
    .query("executions")
    .withIndex("by_action", (q) => q.eq("actionId", actionId))
    .unique();
  if (prior !== null) {
    return {
      executionId: prior._id,
      result: prior.result,
      refusalReason: prior.refusalReason,
      deduplicated: true,
    };
  }
  if (action.state !== "queued") {
    throw new ConvexError({ code: "invariant", message: `action ${actionId} is ${action.state} with no execution record` });
  }

  const session = await getSession(ctx, sessionId);
  const revision = await getInSession(ctx, sessionId, action.proposalRevisionId);
  const proposal = await getInSession(ctx, sessionId, revision.proposalId);

  let decision = await authorize(ctx, action, proposal);

  // Step 4: re-run G1–G8 on current state.
  let failures: GuardrailFailure[] = [];
  if (decision.kind === "proceed") {
    const check = await checkPlan(ctx, sessionId, proposal, revision);
    failures = check.failures;
    if (!check.ok) {
      const approval = action.approvalId ? await ctx.db.get(action.approvalId) : null;
      const base = approval?.baseStateVersion ?? revision.baseStateVersion;
      decision = {
        kind: "refuse",
        reason: base !== session.stateVersion ? "stale_approval" : "guardrail_failed",
        evidenceIds: [...decision.evidenceIds, revision._id],
        failures,
      };
    }
  }

  const now = Date.now();
  const before = session.stateVersion;

  // Step 6: refusal. Record it and return normally.
  if (decision.kind === "refuse") {
    await ctx.db.patch(actionId, { state: "refused", refusalReason: decision.reason });
    const executionId = await ctx.db.insert("executions", {
      sessionId,
      actionId,
      result: "refused",
      refusalReason: decision.reason,
      guardrailFailures: decision.failures ?? [],
      evidenceIds: decision.evidenceIds,
      stateVersionBefore: before,
      stateVersionAfter: before,
      executedAt: now,
    });
    await writeAudit(ctx, {
      sessionId,
      kind: "action.refused",
      actor,
      refs: [actionId, executionId, ...decision.evidenceIds],
      detail: decision.reason,
    });
    return { executionId, result: "refused", refusalReason: decision.reason, deduplicated: false };
  }

  // Injected ERP write failure (fault scenario): a committed `failed`
  // result with no business-state change.
  if (session.injectWriteFailure) {
    await ctx.db.patch(actionId, { state: "failed" });
    const executionId = await ctx.db.insert("executions", {
      sessionId,
      actionId,
      result: "failed",
      guardrailFailures: [],
      evidenceIds: decision.evidenceIds,
      stateVersionBefore: before,
      stateVersionAfter: before,
      executedAt: now,
    });
    await writeAudit(ctx, { sessionId, kind: "action.failed", actor, refs: [actionId, executionId], detail: "injected ERP write failure" });
    return { executionId, result: "failed", deduplicated: false };
  }

  // Step 5: write exactly the revision's diff.
  const { movable } = await loadJobs(ctx, sessionId);
  const diff = scheduleDiff(movable.map(toJob), revision.schedule);
  await applyDiff(ctx, sessionId, movable, diff);
  await ctx.db.patch(sessionId, { stateVersion: before + 1 });
  await ctx.db.patch(actionId, { state: "executed" });
  const executionId = await ctx.db.insert("executions", {
    sessionId,
    actionId,
    result: "executed",
    guardrailFailures: [],
    evidenceIds: decision.evidenceIds,
    stateVersionBefore: before,
    stateVersionAfter: before + 1,
    diff,
    executedAt: now,
  });
  await writeAudit(ctx, {
    sessionId,
    kind: "action.executed",
    actor,
    refs: [actionId, executionId, revision._id],
    detail: `+${diff.added.length} −${diff.removed.length} jobs`,
  });
  return { executionId, result: "executed", deduplicated: false };
}
