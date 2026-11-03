import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { currentPermission, effectiveLevel, getSession, writeAudit } from "./lib/records";
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
  return changeId;
}

async function requireManifest(ctx: MutationCtx, manifestHash: string) {
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
