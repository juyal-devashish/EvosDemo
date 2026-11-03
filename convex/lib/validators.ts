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

// Factory snapshot (mirrors sim/domain.ts#FactorySnapshot).

const lineType = v.union(v.literal("SMT"), v.literal("THT"));
const interval = v.object({ start: v.number(), end: v.number() });
const cycleTime = v.object({ lineId: v.string(), partFamily: v.string(), hoursPerUnit: v.number() });

export const factoryFields = {
  lines: v.array(v.object({ lineId: v.string(), lineType, availability: v.array(interval) })),
  orders: v.array(
    v.object({
      orderId: v.string(),
      lineType,
      partFamily: v.string(),
      qty: v.number(),
      dueHour: v.number(),
      rush: v.boolean(),
      priorityRank: v.number(),
      bom: v.array(v.object({ partNumber: v.string(), qtyPer: v.number() })),
    }),
  ),
  standardCycleTimes: v.array(cycleTime),
  mesObservations: v.array(
    v.object({ ...cycleTime.fields, day: v.number(), shift: v.union(v.literal("A"), v.literal("B")) }),
  ),
  stock: v.array(v.object({ partNumber: v.string(), onHand: v.number() })),
  arrivals: v.array(
    v.object({ partNumber: v.string(), qty: v.number(), arrivalHour: v.number(), confirmed: v.boolean() }),
  ),
  reservations: v.array(
    v.object({ reservationId: v.string(), holder: v.string(), partNumber: v.string(), qty: v.number() }),
  ),
  dataAsOfShift: v.object({ erp_routing: v.number(), erp_stock: v.number(), mes_cycle_times: v.number() }),
};

export const seedJob = v.object({ ...scheduleEntry.fields, partFamily: v.string(), frozen: v.boolean() });

export const attemptStatus = v.union(
  v.literal("pending"),
  v.literal("ok"),
  v.literal("api_error"),
  v.literal("timeout"),
  v.literal("refusal"),
  v.literal("parse_fail"),
  v.literal("budget_blocked"),
);

export const usage = v.object({
  input_tokens: v.number(),
  output_tokens: v.number(),
  cache_creation_input_tokens: v.union(v.number(), v.null()),
  cache_read_input_tokens: v.union(v.number(), v.null()),
});

export const provenance = v.object({
  sources: v.array(
    v.object({
      source: v.union(v.literal("erp_routing"), v.literal("erp_stock"), v.literal("mes_cycle_times")),
      ageShifts: v.number(),
    }),
  ),
});
