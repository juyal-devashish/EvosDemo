import type { Hour, ScheduledJob } from "../sim/domain";

// Hard guardrails G1–G8 (SPEC §7). Pure functions: no I/O, no AI calls.
// Run at proposal time and again inside the execution transaction.
// Approval can't override a failure; only a corrected revision can.

export type GuardrailId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";

export type GuardrailFailure = { id: GuardrailId; message: string; orderId?: string };

export type GuardrailInput = {
  grantedScope: string;
  proposalScope: string;
  horizonHours: Hour;
  /** Started work: occupies its line until its end and can't be moved. */
  frozenJobs: readonly ScheduledJob[];
  /** The revision's whole schedule of movable jobs. */
  schedule: readonly ScheduledJob[];
};

export type GuardrailResult = {
  ok: boolean;
  failures: GuardrailFailure[];
  /**
   * Guardrails this version can't evaluate yet. They need factory data
   * (line types, materials, cycle times, data ages) that arrives in step 2.
   * Step 2 must empty this list; see plan.md.
   */
  notYetImplemented: GuardrailId[];
};

export const GUARDRAIL_VERSION = "g-0.1-partial";

/** G5 (structural part): finite hours, positive length, one job per order. */
export function g5SchemaValid(schedule: readonly ScheduledJob[]): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  const seen = new Set<string>();
  for (const job of schedule) {
    if (!Number.isFinite(job.startHour) || !Number.isFinite(job.endHour)) {
      failures.push({ id: "G5", orderId: job.orderId, message: "non-finite hour" });
    } else if (job.endHour <= job.startHour) {
      failures.push({ id: "G5", orderId: job.orderId, message: "job must end after it starts" });
    }
    if (seen.has(job.orderId)) {
      failures.push({ id: "G5", orderId: job.orderId, message: "order scheduled more than once" });
    }
    seen.add(job.orderId);
  }
  return failures;
}

/** G1: no overlap with other jobs or frozen work on the same line; frozen work can't move. */
export function g1NoOverlap(
  schedule: readonly ScheduledJob[],
  frozenJobs: readonly ScheduledJob[],
): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  const frozenOrders = new Set(frozenJobs.map((j) => j.orderId));
  for (const job of schedule) {
    if (frozenOrders.has(job.orderId)) {
      failures.push({ id: "G1", orderId: job.orderId, message: "frozen job can't be rescheduled" });
    }
  }
  const all = [...frozenJobs, ...schedule];
  for (let i = 0; i < schedule.length; i++) {
    const a = schedule[i];
    for (const b of all) {
      if (b === a || b.lineId !== a.lineId) continue;
      // Each movable pair is reported once (only when b comes later in `schedule`).
      const bIndex = schedule.indexOf(b);
      if (bIndex !== -1 && bIndex < i) continue;
      if (a.startHour < b.endHour && b.startHour < a.endHour) {
        failures.push({
          id: "G1",
          orderId: a.orderId,
          message: `overlaps ${b.orderId} on ${a.lineId}`,
        });
      }
    }
  }
  return failures;
}

/** G4 (horizon part): every job inside [0, horizon]. Availability intervals arrive in step 2. */
export function g4InsideHorizon(
  schedule: readonly ScheduledJob[],
  horizonHours: Hour,
): GuardrailFailure[] {
  return schedule
    .filter((j) => j.startHour < 0 || j.endHour > horizonHours)
    .map((j) => ({ id: "G4" as const, orderId: j.orderId, message: "outside the horizon" }));
}

/** G6: the proposal only touches the granted scope. */
export function g6InScope(grantedScope: string, proposalScope: string): GuardrailFailure[] {
  return grantedScope === proposalScope
    ? []
    : [{ id: "G6", message: `scope ${proposalScope} not granted (${grantedScope})` }];
}

export function runGuardrails(input: GuardrailInput): GuardrailResult {
  const failures = [
    ...g5SchemaValid(input.schedule),
    ...g1NoOverlap(input.schedule, input.frozenJobs),
    ...g4InsideHorizon(input.schedule, input.horizonHours),
    ...g6InScope(input.grantedScope, input.proposalScope),
  ];
  return { ok: failures.length === 0, failures, notYetImplemented: ["G2", "G3", "G7", "G8"] };
}
