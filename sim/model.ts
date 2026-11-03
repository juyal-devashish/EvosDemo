import {
  EPS,
  SETUP_HOURS,
  type CycleTime,
  type DataSource,
  type FactorySnapshot,
  type Hour,
  type Line,
  type LineId,
  type Order,
  type OrderId,
  type PartFamily,
  type ScheduledJob,
} from "./domain";

// Scheduling model (SPEC §3). Pure functions shared by the guardrails,
// suite checks and oracle. The oracle and the checks use these helpers but
// are separate code paths: the oracle searches, the checks verify.

/** Policy default when a manifest's data view sets no freshness limit. */
export const POLICY_MAX_DATA_AGE_SHIFTS = 2;

export type CycleTimeFn = (lineId: LineId, partFamily: PartFamily) => number | undefined;

export function cycleTimeLookup(table: readonly CycleTime[]): CycleTimeFn {
  const map = new Map(table.map((c) => [`${c.lineId}|${c.partFamily}`, c.hoursPerUnit]));
  return (lineId, partFamily) => map.get(`${lineId}|${partFamily}`);
}

/** ERP routing standard: the source of record (G7). */
export const standardCycleTime = (s: FactorySnapshot): CycleTimeFn => cycleTimeLookup(s.standardCycleTimes);

/** Mean MES-observed cycle time for (line, family); falls back to the standard. */
export function observedCycleTime(s: FactorySnapshot): CycleTimeFn {
  const standard = standardCycleTime(s);
  const sums = new Map<string, { total: number; n: number }>();
  for (const o of s.mesObservations) {
    const k = `${o.lineId}|${o.partFamily}`;
    const acc = sums.get(k) ?? { total: 0, n: 0 };
    sums.set(k, { total: acc.total + o.hoursPerUnit, n: acc.n + 1 });
  }
  return (lineId, partFamily) => {
    const acc = sums.get(`${lineId}|${partFamily}`);
    return acc ? acc.total / acc.n : standard(lineId, partFamily);
  };
}

/** `qty × cycleTime + setup`, with setup when the predecessor's family differs. */
export function jobDuration(
  order: Pick<Order, "qty" | "partFamily">,
  hoursPerUnit: number,
  predecessorFamily: PartFamily | undefined,
): Hour {
  const setup = predecessorFamily !== undefined && predecessorFamily !== order.partFamily ? SETUP_HOURS : 0;
  return order.qty * hoursPerUnit + setup;
}

/**
 * Part family of the job that runs right before each scheduled job on its
 * line (frozen work included), by start hour. Undefined when it's first.
 */
export function predecessorFamilies(
  s: FactorySnapshot,
  schedule: readonly ScheduledJob[],
): Map<OrderId, PartFamily | undefined> {
  const familyOf = new Map<OrderId, PartFamily>();
  for (const o of s.orders) familyOf.set(o.orderId, o.partFamily);
  for (const f of s.frozenJobs) familyOf.set(f.orderId, f.partFamily);

  const byLine = new Map<LineId, ScheduledJob[]>();
  for (const j of [...s.frozenJobs, ...schedule]) {
    byLine.set(j.lineId, [...(byLine.get(j.lineId) ?? []), j]);
  }
  const result = new Map<OrderId, PartFamily | undefined>();
  for (const jobs of byLine.values()) {
    jobs.sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour);
    jobs.forEach((j, i) => {
      if (i === 0) result.set(j.orderId, undefined);
      else result.set(j.orderId, familyOf.get(jobs[i - 1].orderId));
    });
  }
  return result;
}

/** A job runs continuously, so it must fit inside a single availability interval. */
export function fitsAvailability(line: Line, start: Hour, end: Hour): boolean {
  return line.availability.some((i) => start >= i.start - EPS && end <= i.end + EPS);
}

/** Units of `partNumber` usable at hour `t`, before any movable job consumes. */
export function availableAt(s: FactorySnapshot, partNumber: string, t: Hour): number {
  const onHand = s.stock.find((x) => x.partNumber === partNumber)?.onHand ?? 0;
  const arrived = s.arrivals
    .filter((a) => a.partNumber === partNumber && a.confirmed && a.arrivalHour <= t + EPS)
    .reduce((sum, a) => sum + a.qty, 0);
  const reserved = s.reservations
    .filter((r) => r.partNumber === partNumber)
    .reduce((sum, r) => sum + r.qty, 0);
  return onHand + arrived - reserved;
}

export type MaterialShortfall = { orderId: OrderId; partNumber: string; short: number; atHour: Hour };

/**
 * Material conservation (§3): a job may start at `t` only if
 * onHand + confirmedArrivals(≤ t) − reservations − consumption by jobs
 * starting ≤ t ≥ 0. Jobs consume their whole requirement at start.
 */
export function materialShortfalls(s: FactorySnapshot, schedule: readonly ScheduledJob[]): MaterialShortfall[] {
  const orders = new Map(s.orders.map((o) => [o.orderId, o]));
  const parts = new Set(s.orders.flatMap((o) => o.bom.map((b) => b.partNumber)));
  const out: MaterialShortfall[] = [];
  for (const partNumber of parts) {
    const users = schedule
      .map((j) => {
        const need = orders.get(j.orderId)?.bom.find((b) => b.partNumber === partNumber);
        return need ? { job: j, need: need.qtyPer * (orders.get(j.orderId)?.qty ?? 0) } : null;
      })
      .filter((u): u is { job: ScheduledJob; need: number } => u !== null);
    for (const u of users) {
      const t = u.job.startHour;
      const consumed = users.filter((x) => x.job.startHour <= t + EPS).reduce((sum, x) => sum + x.need, 0);
      const balance = availableAt(s, partNumber, t) - consumed;
      if (balance < -EPS) out.push({ orderId: u.job.orderId, partNumber, short: -balance, atHour: t });
    }
  }
  return out;
}

/** Sources an order's date commitment depends on. */
export function commitmentSources(order: Order, includeMes: boolean): DataSource[] {
  const sources: DataSource[] = ["erp_routing"];
  if (order.bom.length > 0) sources.push("erp_stock");
  if (includeMes) sources.push("mes_cycle_times");
  return sources;
}

/** Age in shifts of each source, computed server-side from `dataAsOfShift`. */
export function dataAgeShifts(s: FactorySnapshot, source: DataSource): number {
  return s.nowShift - s.dataAsOfShift[source];
}

/** Orders whose commitments would depend on data older than `maxAgeShifts` (G8). */
export function staleOrders(s: FactorySnapshot, includeMes: boolean, maxAgeShifts: number): Set<OrderId> {
  return new Set(
    s.orders
      .filter((o) => commitmentSources(o, includeMes).some((src) => dataAgeShifts(s, src) > maxAgeShifts))
      .map((o) => o.orderId),
  );
}

/**
 * Documented priority rule: rush before non-rush, then earlier due hour,
 * then lower `priorityRank`. Returns < 0 if `a` goes first, 0 on a true tie
 * (which must be escalated, not decided silently).
 */
export function comparePriority(a: Order, b: Order): number {
  if (a.rush !== b.rush) return a.rush ? -1 : 1;
  if (a.dueHour !== b.dueHour) return a.dueHour - b.dueHour;
  return a.priorityRank - b.priorityRank;
}
