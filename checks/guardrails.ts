import { EPS, type FactorySnapshot, type Plan, type ScheduledJob } from "../sim/domain";
import {
  POLICY_MAX_DATA_AGE_SHIFTS,
  fitsAvailability,
  jobDuration,
  materialShortfalls,
  predecessorFamilies,
  staleOrders,
  standardCycleTime,
} from "../sim/model";

// Hard guardrails G1–G8 (SPEC §7). Pure functions: no I/O, no AI calls.
// Run at proposal time and again inside the execution transaction.
// Approval can't override a failure; only a corrected revision can.

export type GuardrailId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";

export type GuardrailFailure = { id: GuardrailId; message: string; orderId?: string };

export type DataViewPolicy = { includeMesCycleTimes: boolean; maxDataAgeShifts?: number };

export type GuardrailInput = {
  grantedScope: string;
  proposalScope: string;
  snapshot: FactorySnapshot;
  plan: Pick<Plan, "schedule" | "dispositions">;
  dataView: DataViewPolicy;
};

export type GuardrailResult = { ok: boolean; failures: GuardrailFailure[] };

export const GUARDRAIL_VERSION = "g-1.0";

/** G1: no overlap with other jobs or frozen work on a line; frozen work can't move. */
export function g1NoOverlap(snapshot: FactorySnapshot, schedule: readonly ScheduledJob[]): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  const frozenOrders = new Set(snapshot.frozenJobs.map((j) => j.orderId));
  for (const job of schedule) {
    if (frozenOrders.has(job.orderId)) {
      failures.push({ id: "G1", orderId: job.orderId, message: "frozen job can't be rescheduled" });
    }
  }
  for (let i = 0; i < schedule.length; i++) {
    const a = schedule[i];
    // Frozen work, then movable jobs later in the list (each pair reported once).
    for (const b of [...snapshot.frozenJobs, ...schedule.slice(i + 1)]) {
      if (b.lineId === a.lineId && a.startHour < b.endHour - EPS && b.startHour < a.endHour - EPS) {
        failures.push({ id: "G1", orderId: a.orderId, message: `overlaps ${b.orderId} on ${a.lineId}` });
      }
    }
  }
  return failures;
}

/** G2: material conservation including reservations and confirmed arrivals. */
export function g2Materials(snapshot: FactorySnapshot, schedule: readonly ScheduledJob[]): GuardrailFailure[] {
  return materialShortfalls(snapshot, schedule).map((m) => ({
    id: "G2" as const,
    orderId: m.orderId,
    message: `${m.partNumber} short by ${m.short} at hour ${m.atHour}`,
  }));
}

/** G3: the job's line exists and has the order's required line type. */
export function g3LineType(snapshot: FactorySnapshot, schedule: readonly ScheduledJob[]): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  for (const job of schedule) {
    const order = snapshot.orders.find((o) => o.orderId === job.orderId);
    const line = snapshot.lines.find((l) => l.lineId === job.lineId);
    if (order === undefined) continue; // reported by G6
    if (line === undefined) {
      failures.push({ id: "G3", orderId: job.orderId, message: `unknown line ${job.lineId}` });
    } else if (line.lineType !== order.lineType) {
      failures.push({
        id: "G3",
        orderId: job.orderId,
        message: `${order.lineType} order on ${line.lineType} line ${line.lineId}`,
      });
    }
  }
  return failures;
}

/** G4: each job inside one availability interval of its line, and inside the horizon. */
export function g4Availability(snapshot: FactorySnapshot, schedule: readonly ScheduledJob[]): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  for (const job of schedule) {
    if (job.startHour < -EPS || job.endHour > snapshot.horizonHours + EPS) {
      failures.push({ id: "G4", orderId: job.orderId, message: "outside the horizon" });
      continue;
    }
    const line = snapshot.lines.find((l) => l.lineId === job.lineId);
    if (line !== undefined && !fitsAvailability(line, job.startHour, job.endHour)) {
      failures.push({ id: "G4", orderId: job.orderId, message: `${job.lineId} not available ${job.startHour}–${job.endHour}` });
    }
  }
  return failures;
}

/**
 * G5 (structural; the Zod schema check on model output is added in step 3):
 * finite hours with positive length, one job and at most one disposition
 * per order, and `scheduled` exactly for orders in the schedule.
 */
export function g5SchemaValid(plan: GuardrailInput["plan"]): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  const scheduled = new Set<string>();
  for (const job of plan.schedule) {
    if (!Number.isFinite(job.startHour) || !Number.isFinite(job.endHour)) {
      failures.push({ id: "G5", orderId: job.orderId, message: "non-finite hour" });
    } else if (job.endHour <= job.startHour) {
      failures.push({ id: "G5", orderId: job.orderId, message: "job must end after it starts" });
    }
    if (scheduled.has(job.orderId)) {
      failures.push({ id: "G5", orderId: job.orderId, message: "order scheduled more than once" });
    }
    scheduled.add(job.orderId);
  }
  const disposed = new Set<string>();
  for (const d of plan.dispositions) {
    if (disposed.has(d.orderId)) {
      failures.push({ id: "G5", orderId: d.orderId, message: "more than one disposition" });
    }
    disposed.add(d.orderId);
    if ((d.status === "scheduled") !== scheduled.has(d.orderId)) {
      failures.push({ id: "G5", orderId: d.orderId, message: "status `scheduled` must match the schedule" });
    }
    if (d.cannotFinishBefore !== undefined && !Number.isFinite(d.cannotFinishBefore)) {
      failures.push({ id: "G5", orderId: d.orderId, message: "non-finite cannotFinishBefore" });
    }
  }
  return failures;
}

/** G6: only the granted scope, and only open movable orders. */
export function g6InScope(input: GuardrailInput): GuardrailFailure[] {
  const failures: GuardrailFailure[] = [];
  if (input.grantedScope !== input.proposalScope) {
    failures.push({ id: "G6", message: `scope ${input.proposalScope} not granted (${input.grantedScope})` });
  }
  const open = new Set(input.snapshot.orders.map((o) => o.orderId));
  const frozen = new Set(input.snapshot.frozenJobs.map((j) => j.orderId));
  const touched = [...input.plan.schedule.map((j) => j.orderId), ...input.plan.dispositions.map((d) => d.orderId)];
  for (const orderId of new Set(touched)) {
    if (!open.has(orderId) && !frozen.has(orderId)) {
      failures.push({ id: "G6", orderId, message: "not an open order in scope" });
    }
  }
  return failures;
}

/**
 * G7: no shrinking jobs. Each job lasts at least the backend-calculated
 * duration from the source of record (ERP standard), including setup.
 * Drift is deliberately not caught here: the standard hasn't changed.
 */
export function g7Duration(snapshot: FactorySnapshot, schedule: readonly ScheduledJob[]): GuardrailFailure[] {
  const ct = standardCycleTime(snapshot);
  const preds = predecessorFamilies(snapshot, schedule);
  const failures: GuardrailFailure[] = [];
  for (const job of schedule) {
    const order = snapshot.orders.find((o) => o.orderId === job.orderId);
    if (order === undefined) continue; // G6
    const line = snapshot.lines.find((l) => l.lineId === job.lineId);
    if (line === undefined || line.lineType !== order.lineType) continue; // G3
    const perUnit = ct(job.lineId, order.partFamily);
    if (perUnit === undefined) {
      failures.push({ id: "G7", orderId: job.orderId, message: `no routing standard for ${job.lineId}/${order.partFamily}` });
      continue;
    }
    const min = jobDuration(order, perUnit, preds.get(job.orderId));
    if (job.endHour - job.startHour < min - EPS) {
      failures.push({
        id: "G7",
        orderId: job.orderId,
        message: `duration ${job.endHour - job.startHour} h below calculated ${min} h`,
      });
    }
  }
  return failures;
}

/** G8: no commitment depends on data older than the manifest's limit (age computed server-side). */
export function g8DataFreshness(input: GuardrailInput): GuardrailFailure[] {
  const maxAge = input.dataView.maxDataAgeShifts ?? POLICY_MAX_DATA_AGE_SHIFTS;
  const stale = staleOrders(input.snapshot, input.dataView.includeMesCycleTimes, maxAge);
  return input.plan.dispositions
    .filter((d) => d.commitment !== "none" && stale.has(d.orderId))
    .map((d) => ({
      id: "G8" as const,
      orderId: d.orderId,
      message: `commitment depends on data older than ${maxAge} shifts`,
    }));
}

export function runGuardrails(input: GuardrailInput): GuardrailResult {
  const { snapshot, plan } = input;
  const failures = [
    ...g1NoOverlap(snapshot, plan.schedule),
    ...g2Materials(snapshot, plan.schedule),
    ...g3LineType(snapshot, plan.schedule),
    ...g4Availability(snapshot, plan.schedule),
    ...g5SchemaValid(plan),
    ...g6InScope(input),
    ...g7Duration(snapshot, plan.schedule),
    ...g8DataFreshness(input),
  ];
  return { ok: failures.length === 0, failures };
}
