import { v, type Infer } from "convex/values";

// Shared validators for the Convex schema and function args (SPEC §6, §9).

export const scope = v.literal("scheduling");
export type Scope = Infer<typeof scope>;

export const role = v.union(v.literal("planner"), v.literal("qa"));
export type Role = Infer<typeof role>;

/** Permission levels (SPEC §9.4). `demoted` behaves as `supervised`. */
export const permissionLevel = v.union(
  v.literal("shadow"),
  v.literal("supervised"),
  v.literal("limited"),
  v.literal("demoted"),
);
export type PermissionLevel = Infer<typeof permissionLevel>;

export const scheduleEntry = v.object({
  orderId: v.string(),
  lineId: v.string(),
  startHour: v.number(),
  endHour: v.number(),
});

export const disposition = v.object({
  orderId: v.string(),
  status: v.union(v.literal("scheduled"), v.literal("held"), v.literal("escalated")),
  commitment: v.union(v.literal("on_time"), v.literal("late"), v.literal("none")),
  cannotFinishBefore: v.optional(v.number()),
});

export const escalation = v.object({
  orderId: v.optional(v.string()),
  reason: v.string(),
});

/** The plan body carried by every proposal revision (SPEC §6). */
export const plan = {
  schedule: v.array(scheduleEntry),
  dispositions: v.array(disposition),
  escalations: v.array(escalation),
  summary: v.string(),
};
export const planObject = v.object(plan);
export type Plan = Infer<typeof planObject>;

export const dataView = v.object({
  includeMesCycleTimes: v.boolean(),
  maxDataAgeShifts: v.optional(v.number()),
});

export const manifestFields = {
  manifestHash: v.string(),
  operatorVersion: v.string(),
  promptHash: v.string(),
  model: v.string(),
  effort: v.string(),
  maxTokens: v.number(),
  dataView,
  guardrailVersion: v.string(),
  policyVersion: v.string(),
  suiteVersion: v.string(),
  scope,
};

/**
 * Why an action did not execute. `failed` (injected write failure) is a
 * separate outcome, not a refusal.
 */
export const refusalReason = v.union(
  v.literal("shadow_never_executes"),
  v.literal("not_permitted"),
  v.literal("no_valid_approval"),
  v.literal("revision_superseded"),
  v.literal("superseded"),
  v.literal("guardrail_failed"),
  v.literal("stale_approval"),
  v.literal("manifest_mismatch"),
);
export type RefusalReason = Infer<typeof refusalReason>;

export const actionState = v.union(
  v.literal("queued"),
  v.literal("executed"),
  v.literal("refused"),
  v.literal("failed"),
);

export const executionResult = v.union(
  v.literal("executed"),
  v.literal("refused"),
  v.literal("failed"),
);
export type ExecutionResult = Infer<typeof executionResult>;

export const guardrailFailure = v.object({
  id: v.string(),
  message: v.string(),
  orderId: v.optional(v.string()),
});

export const scheduleDiff = v.object({
  added: v.array(scheduleEntry),
  removed: v.array(scheduleEntry),
});
