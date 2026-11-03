import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { currentPermission, effectiveLevel, getSession, writeAudit } from "./lib/records";
import { reportEvent } from "./lib/telemetry";
import { MONITOR_CONFIG } from "../stats/config";
import { clopperPearsonLower } from "../stats/binomial";
import { manifestFields, type PermissionLevel, type Scope } from "./lib/validators";

// Permission ladder (SPEC §9.4), per sessionId × manifestHash × scope.
//   — → shadow                default; no row
//   shadow → supervised       rs-1.0 passed for this manifest + qa
//   supervised → limited      + recovery evidence (§10.6); built in steps 6–7
//   limited → demoted         monitor signal, automatic (the only automatic trigger)
//   fault-injection override  faultInjection sessions only
// A new manifest never inherits: the key includes the manifest hash.

type Key = { sessionId: Id<"sessions">; manifestHash: string; scope: Scope };

const SCOPE: Scope = "scheduling";

export async function setLevel(
  ctx: MutationCtx,
  key: Key,
  change: {
    to: PermissionLevel;
    trigger: "qa_authorization" | "monitor_signal" | "fault_injection_override" | "suite_harness";
    actor: Actor;
    evidenceIds: string[];
    note?: string;
  },
) {
  const { level: from, row } = await currentPermission(ctx, key);
  const changeId = await ctx.db.insert("permissionChanges", {
    ...key,
    from,
    to: change.to,
    trigger: change.trigger,
    actor: change.actor,
    evidenceIds: change.evidenceIds,
    note: change.note,
    changedAt: Date.now(),
  });
  const viaFaultInjection =
    change.trigger === "fault_injection_override" ||
    (change.to === "demoted" && (row?.viaFaultInjection ?? false));
  if (row === null) {
    await ctx.db.insert("permissions", { ...key, level: change.to, viaFaultInjection, lastChangeId: changeId });
  } else {
    await ctx.db.patch(row._id, { level: change.to, viaFaultInjection, lastChangeId: changeId });
  }
  await writeAudit(ctx, {
    sessionId: key.sessionId,
    kind: change.to === "demoted" ? "permission.demoted" : "permission.changed",
    actor: change.actor,
    refs: [changeId, ...change.evidenceIds],
    detail: `${from} → ${change.to} (${change.trigger}) for ${key.manifestHash}`,
  });
  if (change.to === "demoted") {
    await reportEvent(ctx, "permission.demoted", {
      sessionId: key.sessionId,
      manifestHash: key.manifestHash,
      permissionChangeId: changeId,
      evidenceIds: change.evidenceIds,
    });
  }
  return changeId;
}

async function requireManifest(ctx: QueryCtx, manifestHash: string) {
  const manifest = await ctx.db
    .query("manifests")
    .withIndex("by_hash", (q) => q.eq("manifestHash", manifestHash))
    .unique();
  if (manifest === null) throw new ConvexError({ code: "not_found", manifestHash });
  return manifest;
}

export const get = query({
  args: { sessionId: v.id("sessions"), manifestHash: v.string() },
  handler: async (ctx, args) => {
    const { level, row } = await currentPermission(ctx, { ...args, scope: SCOPE });
    return { level, viaFaultInjection: row?.viaFaultInjection ?? false };
  },
});

/** shadow → supervised: needs a passed suite verdict for this exact manifest, and qa. */
export const promoteToSupervised = mutation({
  args: { sessionId: v.id("sessions"), manifestHash: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    await getSession(ctx, args.sessionId);
    const manifest = await requireManifest(ctx, args.manifestHash);
    const key = { ...args, scope: SCOPE };
    const { level } = await currentPermission(ctx, key);
    if (level !== "shadow") {
      throw new ConvexError({ code: "invalid_transition", from: level, to: "supervised" });
    }
    const verdicts = await ctx.db
      .query("suiteVerdicts")
      .withIndex("by_manifest", (q) =>
        q.eq("manifestHash", args.manifestHash).eq("suiteVersion", manifest.suiteVersion),
      )
      .collect();
    const passed = verdicts.find((r) => r.verdict === "passed");
    if (passed === undefined) {
      throw new ConvexError({ code: "suite_not_passed", suiteVersion: manifest.suiteVersion });
    }
    return setLevel(ctx, key, {
      to: "supervised",
      trigger: "qa_authorization",
      actor,
      evidenceIds: [passed._id],
    });
  },
});

/**
 * Labeled fault-injection override: grant limited autonomy without the
 * normal evidence. Only in sessions flagged `faultInjection` (never demo).
 */
export const faultInjectionOverride = mutation({
  args: { sessionId: v.id("sessions"), manifestHash: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    const session = await getSession(ctx, args.sessionId);
    if (!session.faultInjection) {
      throw new ConvexError({ code: "fault_injection_not_allowed", sessionId: args.sessionId });
    }
    await requireManifest(ctx, args.manifestHash);
    return setLevel(
      ctx,
      { sessionId: args.sessionId, manifestHash: args.manifestHash, scope: SCOPE },
      { to: "limited", trigger: "fault_injection_override", actor, evidenceIds: [], note: args.note },
    );
  },
});

/**
 * limited → demoted. Called only by the monitor (§10.4) when its rule signals.
 * Returns the permission change id, or null if the manifest wasn't limited.
 */
export const demote = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    evidenceIds: v.array(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { evidenceIds, note, ...k }) => {
    const key = { ...k, scope: SCOPE };
    const { level } = await currentPermission(ctx, key);
    if (effectiveLevel(level) !== "limited") return null;
    return setLevel(ctx, key, {
      to: "demoted",
      trigger: "monitor_signal",
      actor: systemActor("monitor"),
      evidenceIds,
      note,
    });
  },
});

export const registerManifest = internalMutation({
  args: manifestFields,
  handler: async (ctx, manifest) => {
    const existing = await ctx.db
      .query("manifests")
      .withIndex("by_hash", (q) => q.eq("manifestHash", manifest.manifestHash))
      .unique();
    return existing?._id ?? ctx.db.insert("manifests", manifest);
  },
});

/** Placeholder writer for suite verdicts; step 4 records these from real suite runs. */
export const recordSuiteVerdict = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    suiteVersion: v.string(),
    verdict: v.union(v.literal("passed"), v.literal("failed"), v.literal("incomplete")),
    scenarioIds: v.array(v.string()),
  },
  handler: async (ctx, args) => ctx.db.insert("suiteVerdicts", { ...args, recordedAt: Date.now() }),
});

/** The regression scenario for the SMT-2 incident: it must be in the passed suite (SPEC §9.4). */
export const INCIDENT_REGRESSION_SCENARIO = "slow-machine";

/**
 * Recovery evidence for supervised → limited or demoted → limited (SPEC
 * §10.6): fresh supervised reviews of routine reschedules for this
 * manifest, taken after the session's most recent demotion, with a
 * one-sided 95% Clopper–Pearson lower bound at or above the pre-set floor.
 */
export async function recoveryEvidence(ctx: QueryCtx, sessionId: Id<"sessions">, manifestHash: string) {
  const demotions = await ctx.db
    .query("permissionChanges")
    .filter((q) => q.and(q.eq(q.field("sessionId"), sessionId), q.eq(q.field("to"), "demoted")))
    .collect();
  const since = Math.max(0, ...demotions.map((d) => d.changedAt));
  const reviews = (
    await ctx.db
      .query("reviews")
      .withIndex("by_session_manifest", (q) => q.eq("sessionId", sessionId).eq("manifestHash", manifestHash))
      .collect()
  ).filter((r) => r.mode === "supervised" && r.jobType === "routine" && r.agreed !== null && r._creationTime > since);
  const n = reviews.length;
  const x = reviews.filter((r) => r.agreed).length;
  const { floor, minFreshReviews, confidence } = MONITOR_CONFIG.recovery;
  const lowerBound = n === 0 ? 0 : clopperPearsonLower(x, n, 1 - confidence);
  return { n, x, lowerBound, floor, minFreshReviews, sufficient: n >= minFreshReviews && lowerBound >= floor, reviewIds: reviews.map((r) => r._id) };
}

export const recoveryStatus = query({
  args: { sessionId: v.id("sessions"), manifestHash: v.string() },
  handler: async (ctx, { sessionId, manifestHash }) => {
    const { reviewIds: _ids, ...rest } = await recoveryEvidence(ctx, sessionId, manifestHash);
    void _ids;
    return rest;
  },
});

/** supervised/demoted → limited: suite (with the regression scenario) + recovery evidence + qa. */
export const promoteToLimited = mutation({
  args: { sessionId: v.id("sessions"), manifestHash: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    await getSession(ctx, args.sessionId);
    const manifest = await requireManifest(ctx, args.manifestHash);
    const key = { ...args, scope: SCOPE };
    const { level } = await currentPermission(ctx, key);
    if (level !== "supervised" && level !== "demoted") {
      throw new ConvexError({ code: "invalid_transition", from: level, to: "limited" });
    }
    const verdicts = await ctx.db
      .query("suiteVerdicts")
      .withIndex("by_manifest", (q) => q.eq("manifestHash", args.manifestHash).eq("suiteVersion", manifest.suiteVersion))
      .collect();
    const passed = verdicts.find((r) => r.verdict === "passed" && r.scenarioIds.includes(INCIDENT_REGRESSION_SCENARIO));
    if (passed === undefined) {
      throw new ConvexError({ code: "suite_not_passed", suiteVersion: manifest.suiteVersion, regression: INCIDENT_REGRESSION_SCENARIO });
    }
    const ev = await recoveryEvidence(ctx, args.sessionId, args.manifestHash);
    if (!ev.sufficient) {
      // Insufficient evidence → stays supervised.
      throw new ConvexError({ code: "insufficient_evidence", n: ev.n, x: ev.x, lowerBound: ev.lowerBound, floor: ev.floor, minFreshReviews: ev.minFreshReviews });
    }
    return setLevel(ctx, key, {
      to: "limited",
      trigger: "qa_authorization",
      actor,
      evidenceIds: [passed._id, ...ev.reviewIds.slice(0, 20)],
      note: `${ev.x}/${ev.n} fresh supervised reviews; 95% lower bound ${ev.lowerBound.toFixed(3)} ≥ floor ${ev.floor}`,
    });
  },
});
