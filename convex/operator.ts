import { ConvexError, v } from "convex/values";
import { callOperator, newClient } from "../operator/call";
import { buildOperatorInput, userMessage } from "../operator/dataView";
import { opV1, opV2, type ManifestBody } from "../operator/manifest";
import { maxCostUsd, maxInputTokensFor } from "../operator/pricing";
import { SYSTEM_PROMPT } from "../operator/prompt";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireRole, systemActor } from "./auth";
import { reserve, settle } from "./budget";
import { loadSnapshot } from "./lib/factory";
import { getSession, writeAudit } from "./lib/records";
import { attemptStatus, planObject, provenance, usage } from "./lib/validators";
import { createOperatorProposal } from "./proposals";

// The operator run: build the data view on the server, reserve budget, call
// the model, then settle the reservation and store the proposal in one
// mutation. The API key is read only here, server-side.

export const loadForCall = internalQuery({
  args: { sessionId: v.id("sessions"), manifestHash: v.string() },
  handler: async (ctx, { sessionId, manifestHash }) => {
    await getSession(ctx, sessionId);
    const manifest = await ctx.db
      .query("manifests")
      .withIndex("by_hash", (q) => q.eq("manifestHash", manifestHash))
      .unique();
    if (manifest === null) throw new ConvexError({ code: "not_found", manifestHash });
    return { manifest, snapshot: await loadSnapshot(ctx, sessionId) };
  },
});

/** Create the attempt and reserve its worst-case cost, atomically. */
export const beginAttempt = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    model: v.string(),
    maxCostUsd: v.number(),
    trialId: v.optional(v.id("trials")),
    n: v.number(),
  },
  handler: async (ctx, args) => {
    const attemptId = await ctx.db.insert("attempts", {
      sessionId: args.sessionId,
      trialId: args.trialId,
      n: args.n,
      manifestHash: args.manifestHash,
      status: "pending",
      maxCostUsd: args.maxCostUsd,
      startedAt: Date.now(),
    });
    const r = await reserve(ctx, { sessionId: args.sessionId, attemptId, model: args.model, maxCostUsd: args.maxCostUsd });
    if (!r.ok) {
      await ctx.db.patch(attemptId, {
        status: "budget_blocked",
        detail: `spent ${r.spentUsd.toFixed(4)} + reserved ${r.reservedUsd.toFixed(4)} + max ${args.maxCostUsd.toFixed(4)} > cap ${r.capUsd}`,
        finishedAt: Date.now(),
      });
      await writeAudit(ctx, {
        sessionId: args.sessionId,
        kind: "attempt.budget_blocked",
        actor: systemActor("operator"),
        refs: [attemptId],
      });
      return { attemptId, blocked: true as const };
    }
    await ctx.db.patch(attemptId, { reservationId: r.reservationId });
    return { attemptId, blocked: false as const };
  },
});

/** Settle the reservation, record the outcome, and on success store the proposal. One transaction. */
export const finishAttempt = internalMutation({
  args: {
    attemptId: v.id("attempts"),
    status: attemptStatus,
    usage: v.union(usage, v.null()),
    stopReason: v.optional(v.union(v.string(), v.null())),
    detail: v.optional(v.string()),
    plan: v.optional(planObject),
    provenance,
    trigger: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (attempt === null || attempt.status !== "pending" || attempt.reservationId === undefined) {
      throw new ConvexError({ code: "invariant", message: `attempt ${args.attemptId} is not pending` });
    }
    const costUsd = await settle(ctx, attempt.reservationId, args.usage);
    let proposalId: Id<"proposals"> | undefined;
    let revisionId: Id<"proposalRevisions"> | undefined;
    if (args.status === "ok" && args.plan !== undefined) {
      ({ proposalId, revisionId } = await createOperatorProposal(ctx, {
        sessionId: attempt.sessionId,
        manifestHash: attempt.manifestHash,
        trigger: args.trigger,
        plan: args.plan,
        attemptId: args.attemptId,
        provenance: args.provenance,
      }));
    }
    await ctx.db.patch(args.attemptId, {
      status: args.status,
      usage: args.usage ?? undefined,
      costUsd: costUsd ?? undefined,
      stopReason: args.stopReason,
      detail: args.detail,
      proposalId,
      finishedAt: Date.now(),
    });
    await writeAudit(ctx, {
      sessionId: attempt.sessionId,
      kind: `attempt.${args.status}`,
      actor: systemActor("operator"),
      refs: [args.attemptId, ...(proposalId ? [proposalId] : [])],
      detail: costUsd === null ? undefined : `$${costUsd.toFixed(4)}`,
    });
    return { proposalId, revisionId, costUsd };
  },
});

export type ProposeResult = {
  attemptId: Id<"attempts">;
  status: "ok" | "api_error" | "timeout" | "refusal" | "parse_fail" | "budget_blocked";
  proposalId?: Id<"proposals">;
  revisionId?: Id<"proposalRevisions">;
  costUsd?: number | null;
};

/**
 * Make one real model call for a session under a manifest. Every call goes
 * through the budget reservation. Tests never call this.
 */
export const propose = internalAction({
  args: {
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    trigger: v.string(),
    trialId: v.optional(v.id("trials")),
    n: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProposeResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new ConvexError({ code: "config", message: "ANTHROPIC_API_KEY is not set in the Convex environment" });

    const { manifest, snapshot } = await ctx.runQuery(internal.operator.loadForCall, {
      sessionId: args.sessionId,
      manifestHash: args.manifestHash,
    });
    const input = buildOperatorInput(snapshot, manifest.dataView);
    const message = userMessage(input);
    const maxCost = maxCostUsd(manifest.model, maxInputTokensFor(SYSTEM_PROMPT + message), manifest.maxTokens);

    const begun = await ctx.runMutation(internal.operator.beginAttempt, {
      sessionId: args.sessionId,
      manifestHash: manifest.manifestHash,
      model: manifest.model,
      maxCostUsd: maxCost,
      trialId: args.trialId,
      n: args.n ?? 1,
    });
    if (begun.blocked) return { attemptId: begun.attemptId, status: "budget_blocked" };

    const outcome = await callOperator(
      newClient(apiKey),
      { ...manifest, effort: manifest.effort as ManifestBody["effort"] },
      message,
    );
    const finished = await ctx.runMutation(internal.operator.finishAttempt, {
      attemptId: begun.attemptId,
      status: outcome.status,
      usage: outcome.usage,
      stopReason: "stopReason" in outcome ? outcome.stopReason : undefined,
      detail: outcome.status === "ok" ? undefined : outcome.detail,
      plan: outcome.status === "ok" ? outcome.plan : undefined,
      provenance: input.provenance,
      trigger: args.trigger,
    });
    return { attemptId: begun.attemptId, status: outcome.status, ...finished };
  },
});

/** Register op-v1 and op-v2 (hashes computed from their full content). */
export const registerManifests = internalAction({
  args: {},
  handler: async (ctx): Promise<{ opV1: string; opV2: string }> => {
    const [v1, v2] = await Promise.all([opV1(), opV2()]);
    await ctx.runMutation(internal.permissions.registerManifest, v1);
    await ctx.runMutation(internal.permissions.registerManifest, v2);
    return { opV1: v1.manifestHash, opV2: v2.manifestHash };
  },
});

/**
 * qa asks the operator for a proposal in a session. REAL API CALL (one).
 * Scheduled so the mutation stays fast; the attempt shows up when done.
 */
export const request = mutation({
  args: { sessionId: v.id("sessions"), manifestHash: v.string(), trigger: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    const session = await getSession(ctx, args.sessionId);
    if (session.kind === "suite") throw new ConvexError({ code: "invalid", message: "suite sessions are driven by suite runs" });
    await ctx.scheduler.runAfter(0, internal.operator.propose, {
      sessionId: args.sessionId,
      manifestHash: args.manifestHash,
      trigger: args.trigger ?? "manual request",
    });
    await writeAudit(ctx, { sessionId: args.sessionId, kind: "operator.requested", actor, refs: [args.manifestHash] });
    return null;
  },
});
