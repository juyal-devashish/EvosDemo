import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actionState,
  attemptStatus,
  factoryFields,
  provenance,
  usage,
  executionResult,
  guardrailFailure,
  manifestFields,
  permissionLevel,
  plan,
  refusalReason,
  role,
  scheduleDiff,
  scope,
} from "./lib/validators";

// SPEC §9. Every state table carries `sessionId` (§9.1). Manifests are
// release definitions shared across sessions, so they are the one exception.
// Records used as evidence (revisions, approvals, permission changes,
// executions, audit) are append-only: no function updates them.

const actor = v.object({
  kind: v.union(v.literal("user"), v.literal("system")),
  /** Clerk subject for users; a job name (e.g. "shiftBoundary") for system. */
  id: v.string(),
  role: v.optional(role),
});

export default defineSchema({
  sessions: defineTable({
    label: v.string(),
    kind: v.union(
      v.literal("suite"),
      v.literal("replay"),
      v.literal("demo"),
      v.literal("test"),
    ),
    /** Only these sessions allow the fault-injection override (§9.4). */
    faultInjection: v.boolean(),
    /** Injected ERP write failure on execution (the failed-write scenario, §5). */
    injectWriteFailure: v.boolean(),
    /** Simulated clock: index of the current shift in the horizon. */
    currentShift: v.number(),
    /** Incremented by every committed business-state change (§9.3). */
    stateVersion: v.number(),
    /** Decision slots (shifts) per simulated day; the replay compresses time to 6. Default 2. */
    slotsPerDay: v.optional(v.number()),
  }),

  manifests: defineTable(manifestFields).index("by_hash", ["manifestHash"]),

  /**
   * Factory data per session (§3): lines, open orders, ERP standard, MES
   * observations, stock, arrivals, reservations and source refresh shifts.
   * True cycle times are simulation truth and never stored here.
   */
  factory: defineTable({ sessionId: v.id("sessions"), ...factoryFields }).index("by_session", ["sessionId"]),

  /** Factory schedule. Frozen jobs are already started and never moved (§3). */
  jobs: defineTable({
    sessionId: v.id("sessions"),
    orderId: v.string(),
    lineId: v.string(),
    startHour: v.number(),
    endHour: v.number(),
    partFamily: v.string(),
    frozen: v.boolean(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_order", ["sessionId", "orderId"]),

  /** One decision = one proposal for one trigger (§9.2). */
  proposals: defineTable({
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    scope,
    trigger: v.string(),
    shift: v.number(),
    latestRevisionId: v.optional(v.id("proposalRevisions")),
    revisionCount: v.number(),
    /** Operator proposals: the model call that produced it. */
    attemptId: v.optional(v.id("attempts")),
    /** Server-recorded data view actually sent to the model (T4). */
    provenance: v.optional(provenance),
  }).index("by_session", ["sessionId"]),

  /** Immutable. An edit creates a new revision (§9.3). */
  proposalRevisions: defineTable({
    sessionId: v.id("sessions"),
    proposalId: v.id("proposals"),
    revisionNumber: v.number(),
    parentRevisionId: v.optional(v.id("proposalRevisions")),
    author: actor,
    /** Factory stateVersion the revision was built against. */
    baseStateVersion: v.number(),
    /** Guardrails at proposal time, against `baseStateVersion` (§7). */
    proposalTimeCheck: v.object({
      ok: v.boolean(),
      failures: v.array(guardrailFailure),
      guardrailVersion: v.string(),
    }),
    ...plan,
  }).index("by_proposal", ["proposalId", "revisionNumber"]),

  /** Immutable. Binds to one revision and one manifest (§9.3). */
  approvals: defineTable({
    sessionId: v.id("sessions"),
    proposalRevisionId: v.id("proposalRevisions"),
    baseStateVersion: v.number(),
    actor,
    manifestHash: v.string(),
    decidedAt: v.number(),
  }).index("by_revision", ["proposalRevisionId"]),

  /** A request to apply one revision at a shift boundary. */
  actions: defineTable({
    sessionId: v.id("sessions"),
    proposalRevisionId: v.id("proposalRevisions"),
    manifestHash: v.string(),
    scope,
    dueShift: v.number(),
    /** The permission the action was queued under. */
    queuedUnder: v.union(v.literal("supervised"), v.literal("limited")),
    approvalId: v.optional(v.id("approvals")),
    state: actionState,
    refusalReason: v.optional(refusalReason),
    queuedAt: v.number(),
  })
    .index("by_session_state", ["sessionId", "state"])
    .index("by_session_scope_shift", ["sessionId", "scope", "dueShift", "state"]),

  /** One per action, written on every outcome. Used for dedup (§9.5 step 3). */
  executions: defineTable({
    sessionId: v.id("sessions"),
    actionId: v.id("actions"),
    result: executionResult,
    refusalReason: v.optional(refusalReason),
    guardrailFailures: v.array(guardrailFailure),
    /** Records the refusal or write relies on (permission change, approval, revision). */
    evidenceIds: v.array(v.string()),
    stateVersionBefore: v.number(),
    stateVersionAfter: v.number(),
    diff: v.optional(scheduleDiff),
    executedAt: v.number(),
  }).index("by_action", ["actionId"]),

  /** Current level per session × manifest × scope. No row means shadow. */
  permissions: defineTable({
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    scope,
    level: permissionLevel,
    viaFaultInjection: v.boolean(),
    lastChangeId: v.id("permissionChanges"),
  }).index("by_key", ["sessionId", "manifestHash", "scope"]),

  /** Immutable history of every level change, with its evidence. */
  permissionChanges: defineTable({
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    scope,
    from: permissionLevel,
    to: permissionLevel,
    trigger: v.union(
      v.literal("qa_authorization"),
      v.literal("monitor_signal"),
      v.literal("fault_injection_override"),
      /** Only inside an isolated suite trial session, to exercise the execution path. */
      v.literal("suite_harness"),
    ),
    actor,
    evidenceIds: v.array(v.string()),
    note: v.optional(v.string()),
    changedAt: v.number(),
  }).index("by_key", ["sessionId", "manifestHash", "scope"]),

  /** One release-suite run of one manifest (SPEC §8). */
  suiteRuns: defineTable({
    /** Coordination session for the run's own records; each trial has its own session. */
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    suiteVersion: v.string(),
    scenarioIds: v.array(v.string()),
    trialsPerScenario: v.number(),
    state: v.union(v.literal("running"), v.literal("complete"), v.literal("cancelled")),
    startedBy: actor,
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    verdict: v.optional(
      v.object({
        kind: v.union(v.literal("passed"), v.literal("failed"), v.literal("incomplete")),
        text: v.string(),
        failures: v.array(
          v.object({ checkId: v.string(), scenarioId: v.string(), failedTrials: v.number(), trials: v.number() }),
        ),
        missing: v.object({ count: v.number(), reasons: v.record(v.string(), v.number()) }),
        perScenario: v.array(
          v.object({
            scenarioId: v.string(),
            trials: v.number(),
            passed: v.number(),
            failed: v.number(),
            missing: v.number(),
            upperBound95: v.optional(v.number()),
          }),
        ),
      }),
    ),
  }).index("by_manifest", ["manifestHash"]),

  /** One trial: stable id, its own seeded session, judged on its first attempt. */
  trials: defineTable({
    suiteRunId: v.id("suiteRuns"),
    trialKey: v.string(),
    scenarioId: v.string(),
    index: v.number(),
    expectedOutcome: v.string(),
    sessionId: v.id("sessions"),
    state: v.union(v.literal("pending"), v.literal("passed"), v.literal("failed"), v.literal("missing")),
    failures: v.optional(v.array(v.object({ id: v.string(), message: v.string(), orderId: v.optional(v.string()) }))),
    missingReason: v.optional(v.string()),
    firstAttemptId: v.optional(v.id("attempts")),
    revisionId: v.optional(v.id("proposalRevisions")),
    finishedAt: v.optional(v.number()),
  })
    .index("by_run", ["suiteRunId", "state"])
    .index("by_key", ["trialKey"]),

  /**
   * Release-suite verdicts per manifest. Step 4 writes these from real suite
   * runs; `sessionId` is the suite run's own session.
   */
  suiteVerdicts: defineTable({
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    suiteVersion: v.string(),
    verdict: v.union(v.literal("passed"), v.literal("failed"), v.literal("incomplete")),
    scenarioIds: v.array(v.string()),
    recordedAt: v.number(),
  }).index("by_manifest", ["manifestHash", "suiteVersion"]),

  /**
   * One model call (SPEC §8). Step 4 links attempts to trials; the verdict
   * uses each trial's first attempt, and retries never replace it.
   */
  attempts: defineTable({
    sessionId: v.id("sessions"),
    trialId: v.optional(v.id("trials")),
    n: v.number(),
    manifestHash: v.string(),
    status: attemptStatus,
    maxCostUsd: v.number(),
    reservationId: v.optional(v.id("budgetReservations")),
    usage: v.optional(usage),
    costUsd: v.optional(v.number()),
    stopReason: v.optional(v.union(v.string(), v.null())),
    detail: v.optional(v.string()),
    proposalId: v.optional(v.id("proposals")),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_trial", ["trialId", "n"]),

  /** Global spend ledger (one row). Hard cap enforced on reservation (SPEC §11). */
  budget: defineTable({
    key: v.literal("global"),
    capUsd: v.number(),
    spentUsd: v.number(),
    reservedUsd: v.number(),
  }).index("by_key", ["key"]),

  budgetReservations: defineTable({
    sessionId: v.id("sessions"),
    attemptId: v.id("attempts"),
    model: v.string(),
    maxCostUsd: v.number(),
    state: v.union(v.literal("open"), v.literal("reconciled"), v.literal("lost")),
    actualCostUsd: v.optional(v.number()),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_state", ["state"]),

  /**
   * Post-execution reviews (§10.2–10.3). In this project the reviewer is the
   * labeled synthetic reviewer. A review annotates a revision; corrections
   * would be new proposals, and history is never rewritten.
   */
  reviews: defineTable({
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    proposalRevisionId: v.id("proposalRevisions"),
    actionId: v.optional(v.id("actions")),
    reviewer: v.literal("synthetic"),
    jobType: v.literal("routine"),
    /** Decided under supervision (before execution) or after execution (limited). */
    mode: v.union(v.literal("supervised"), v.literal("post_execution")),
    proposalDay: v.number(),
    /** null while pending. */
    agreed: v.union(v.boolean(), v.null()),
    shouldEdit: v.boolean(),
    reasons: v.array(v.string()),
    reviewedOnDay: v.optional(v.number()),
  })
    .index("by_session_manifest", ["sessionId", "manifestHash", "proposalDay"])
    .index("by_revision", ["proposalRevisionId"]),

  /** One evaluation of the monitoring rule (§10.4), kept as evidence. */
  monitorWindows: defineTable({
    sessionId: v.id("sessions"),
    manifestHash: v.string(),
    windowIndex: v.number(),
    startDay: v.number(),
    endDay: v.number(),
    evaluatedOnDay: v.number(),
    status: v.union(v.literal("insufficientData"), v.literal("ok"), v.literal("signal")),
    n: v.number(),
    x: v.number(),
    pending: v.number(),
    pValue: v.optional(v.number()),
    p0: v.number(),
    alpha: v.number(),
    reviewIds: v.array(v.id("reviews")),
  }).index("by_session_manifest", ["sessionId", "manifestHash", "windowIndex"]),

  /** Progress of one shift boundary, so a retried boundary resumes instead of repeating (§9.6). */
  boundaryRuns: defineTable({
    sessionId: v.id("sessions"),
    toShift: v.number(),
    closed: v.boolean(),
    evaluated: v.boolean(),
    released: v.boolean(),
    demotionIds: v.array(v.id("permissionChanges")),
    executedActionIds: v.array(v.id("actions")),
  }).index("by_session_shift", ["sessionId", "toShift"]),

  audit: defineTable({
    sessionId: v.id("sessions"),
    kind: v.string(),
    actor,
    refs: v.array(v.string()),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_session", ["sessionId"]),
});
