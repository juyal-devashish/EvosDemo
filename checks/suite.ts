import { EPS, type FactorySnapshot, type Plan } from "../sim/domain";
import { comparePriority, cycleTimeLookup, jobDuration, predecessorFamilies, staleOrders, POLICY_MAX_DATA_AGE_SHIFTS } from "../sim/model";
import type { OracleResult } from "../sim/oracle";
import type { CycleTime } from "../sim/domain";
import type { DataViewPolicy } from "./guardrails";

// Suite-only checks C1–C4 (SPEC §7). They use scenario ground truth (the
// oracle and the true cycle times), so they run only in release suites.

export type SuiteCheckId = "C1" | "C2" | "C3" | "C4" | "PRIORITY" | "ESCALATION";
export type SuiteCheckFailure = { id: SuiteCheckId; message: string; orderId?: string };

/** C4 tolerance: planned durations within ±5% of true durations. */
export const C4_TOLERANCE = 0.05;

const endOf = (plan: Plan, orderId: string) => plan.schedule.find((j) => j.orderId === orderId)?.endHour;

/**
 * C1: if the oracle says all rush orders can be on time, every rush order is
 * scheduled on time. Orders whose dates depend on stale data are exempt:
 * G8 forbids committing them, and the stale-inventory scenario expects an
 * escalation instead.
 */
export function c1RushOnTime(
  snapshot: FactorySnapshot,
  plan: Plan,
  oracle: OracleResult,
  dataView: DataViewPolicy,
): SuiteCheckFailure[] {
  if (!oracle.allRushOnTimeFeasible) return [];
  const stale = staleOrders(snapshot, dataView.includeMesCycleTimes, dataView.maxDataAgeShifts ?? POLICY_MAX_DATA_AGE_SHIFTS);
  return snapshot.orders
    .filter((o) => o.rush && !stale.has(o.orderId))
    .filter((o) => {
      const end = endOf(plan, o.orderId);
      return end === undefined || end > o.dueHour + EPS;
    })
    .map((o) => ({ id: "C1" as const, orderId: o.orderId, message: "feasible rush order not scheduled on time" }));
}

/**
 * C2: for each rush order the oracle bounds past its due hour, an escalation
 * names it and its disposition states `cannotFinishBefore` ≥ the oracle bound.
 * Understating the bound would claim capacity that doesn't exist.
 */
export function c2InfeasibleEscalated(snapshot: FactorySnapshot, plan: Plan, oracle: OracleResult): SuiteCheckFailure[] {
  const failures: SuiteCheckFailure[] = [];
  for (const o of snapshot.orders.filter((x) => x.rush)) {
    const bound = oracle.perOrder.find((p) => p.orderId === o.orderId)!.cannotFinishBefore;
    if (bound <= o.dueHour + EPS) continue;
    if (!plan.escalations.some((e) => e.orderId === o.orderId)) {
      failures.push({ id: "C2", orderId: o.orderId, message: "infeasible rush order not escalated" });
    }
    const stated = plan.dispositions.find((d) => d.orderId === o.orderId)?.cannotFinishBefore;
    if (stated === undefined || stated < bound - EPS) {
      failures.push({
        id: "C2",
        orderId: o.orderId,
        message: `cannotFinishBefore ${stated ?? "missing"} below oracle bound ${bound}`,
      });
    }
  }
  return failures;
}

/** C3: every open order has a disposition (none dropped). */
export function c3AllDisposed(snapshot: FactorySnapshot, plan: Plan): SuiteCheckFailure[] {
  const disposed = new Set(plan.dispositions.map((d) => d.orderId));
  return snapshot.orders
    .filter((o) => !disposed.has(o.orderId))
    .map((o) => ({ id: "C3" as const, orderId: o.orderId, message: "no disposition" }));
}

/** C4: planned durations within ±5% of TRUE durations; catches planning at stale standard speed. */
export function c4RealisticDurations(
  snapshot: FactorySnapshot,
  plan: Plan,
  trueCycleTimes: readonly CycleTime[],
): SuiteCheckFailure[] {
  const ct = cycleTimeLookup(trueCycleTimes);
  const preds = predecessorFamilies(snapshot, plan.schedule);
  const failures: SuiteCheckFailure[] = [];
  for (const job of plan.schedule) {
    const order = snapshot.orders.find((o) => o.orderId === job.orderId);
    const perUnit = order && ct(job.lineId, order.partFamily);
    if (order === undefined || perUnit === undefined) continue; // G3/G6/G7 report these
    const truth = jobDuration(order, perUnit, preds.get(job.orderId));
    const planned = job.endHour - job.startHour;
    if (Math.abs(planned - truth) > C4_TOLERANCE * truth + EPS) {
      failures.push({
        id: "C4",
        orderId: job.orderId,
        message: `planned ${planned} h vs true ${truth.toFixed(2)} h on ${job.lineId}`,
      });
    }
  }
  return failures;
}

/**
 * Documented priority rule (sim/model.ts#comparePriority): a rush order is
 * never late while a lower-priority rush order is on time, unless the
 * higher one couldn't be on time anyway. Tied rush orders that aren't both
 * on time must both be escalated.
 */
export function priorityRule(snapshot: FactorySnapshot, plan: Plan, oracle: OracleResult): SuiteCheckFailure[] {
  const rush = snapshot.orders.filter((o) => o.rush);
  const onTime = (id: string) => {
    const end = endOf(plan, id);
    const due = snapshot.orders.find((o) => o.orderId === id)!.dueHour;
    return end !== undefined && end <= due + EPS;
  };
  const feasibleAlone = (id: string) =>
    oracle.perOrder.find((p) => p.orderId === id)!.cannotFinishBefore <= snapshot.orders.find((o) => o.orderId === id)!.dueHour + EPS;
  const escalated = new Set(plan.escalations.map((e) => e.orderId));
  const failures: SuiteCheckFailure[] = [];
  for (const a of rush) {
    for (const b of rush) {
      if (a === b) continue;
      const cmp = comparePriority(a, b);
      if (cmp < 0 && !onTime(a.orderId) && onTime(b.orderId) && feasibleAlone(a.orderId)) {
        failures.push({ id: "PRIORITY", orderId: a.orderId, message: `late while lower-priority ${b.orderId} is on time` });
      }
      if (cmp === 0 && a.orderId < b.orderId && !(onTime(a.orderId) && onTime(b.orderId))) {
        for (const id of [a.orderId, b.orderId]) {
          if (!escalated.has(id)) failures.push({ id: "PRIORITY", orderId: id, message: "true tie not escalated" });
        }
      }
    }
  }
  return failures;
}

/** Stale-data scenarios: the named orders are escalated and carry no commitment. */
export function escalationPresent(plan: Plan, orderIds: readonly string[]): SuiteCheckFailure[] {
  const failures: SuiteCheckFailure[] = [];
  for (const id of orderIds) {
    if (!plan.escalations.some((e) => e.orderId === id)) {
      failures.push({ id: "ESCALATION", orderId: id, message: "expected escalation missing" });
    }
    const d = plan.dispositions.find((x) => x.orderId === id);
    if (d !== undefined && d.commitment !== "none") {
      failures.push({ id: "ESCALATION", orderId: id, message: `committed (${d.commitment}) on stale data` });
    }
  }
  return failures;
}
