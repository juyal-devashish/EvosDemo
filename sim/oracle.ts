import { EPS, type FactorySnapshot, type Hour, type Line, type Order, type OrderId, type PartFamily, type ScheduledJob } from "./domain";
import { availableAt, fitsAvailability, jobDuration, type CycleTimeFn } from "./model";

// Ground truth per scenario (SPEC §4). Exhaustive search over the ≤ 6
// movable orders: line assignment × order per line, non-preemptive,
// earliest-start packing, using the TRUE cycle times. A separate code path
// from the checks: callers verify the witness with the guardrails.

export const MAX_ORACLE_ORDERS = 6;

export type ReasonCode = "capacity" | "material_arrival" | "line_unavailable" | "no_eligible_line";

export type OraclePerOrder = {
  orderId: OrderId;
  /** End hour in the witness schedule, when there is one. */
  earliestFinishGivenWitness?: Hour;
  /** Lower bound: no schedule finishes this order earlier. Never "earliest achievable". */
  cannotFinishBefore: Hour;
  reasonCodes: ReasonCode[];
};

export type OracleResult = {
  allRushOnTimeFeasible: boolean;
  witnessSchedule?: ScheduledJob[];
  perOrder: OraclePerOrder[];
};

type Placed = ScheduledJob & { partFamily: PartFamily };

type LineCursor = { free: Hour; lastFamily: PartFamily | undefined };

function initialCursors(s: FactorySnapshot): Map<string, LineCursor> {
  const cursors = new Map<string, LineCursor>();
  for (const line of s.lines) {
    const frozen = s.frozenJobs
      .filter((f) => f.lineId === line.lineId)
      .sort((a, b) => a.endHour - b.endHour);
    const last = frozen.at(-1);
    cursors.set(line.lineId, { free: Math.max(0, last?.endHour ?? 0), lastFamily: last?.partFamily });
  }
  return cursors;
}

/** Remaining usable units of each part after the given consumption. */
function materialOk(s: FactorySnapshot, order: Order, t: Hour, consumed: Map<string, number>): boolean {
  return order.bom.every(
    (b) => availableAt(s, b.partNumber, t) - (consumed.get(b.partNumber) ?? 0) - b.qtyPer * order.qty >= -EPS,
  );
}

/**
 * Earliest start ≥ cursor.free where the job fits one availability interval,
 * ends inside the horizon, and its materials are available. The earliest
 * feasible start is always the cursor, an interval start or an arrival hour.
 */
function earliestStart(
  s: FactorySnapshot,
  line: Line,
  order: Order,
  duration: Hour,
  free: Hour,
  consumed: Map<string, number>,
): Hour | null {
  const candidates = new Set<Hour>([free]);
  for (const i of line.availability) if (i.start > free) candidates.add(i.start);
  for (const a of s.arrivals) if (a.confirmed && a.arrivalHour > free) candidates.add(a.arrivalHour);
  for (const t of [...candidates].sort((a, b) => a - b)) {
    const end = t + duration;
    if (end > s.horizonHours + EPS) return null;
    // Material availability only grows with t, but interval fit doesn't:
    // check both at every candidate.
    if (fitsAvailability(line, t, end) && materialOk(s, order, t, consumed)) return t;
  }
  return null;
}

/**
 * Pack per-line sequences with earliest starts. Jobs are placed in global
 * start order so material consumption by earlier starts is known.
 */
function pack(
  s: FactorySnapshot,
  trueCt: CycleTimeFn,
  sequences: Map<string, Order[]>,
): Placed[] | null {
  const cursors = initialCursors(s);
  const heads = new Map([...sequences.keys()].map((l) => [l, 0]));
  const consumed = new Map<string, number>();
  const placed: Placed[] = [];
  const total = [...sequences.values()].reduce((n, seq) => n + seq.length, 0);

  while (placed.length < total) {
    let best: { lineId: string; order: Order; start: Hour; end: Hour } | null = null;
    for (const [lineId, seq] of sequences) {
      const order = seq[heads.get(lineId)!];
      if (order === undefined) continue;
      const line = s.lines.find((l) => l.lineId === lineId)!;
      const cursor = cursors.get(lineId)!;
      const perUnit = trueCt(lineId, order.partFamily);
      if (perUnit === undefined) return null;
      const duration = jobDuration(order, perUnit, cursor.lastFamily);
      const start = earliestStart(s, line, order, duration, cursor.free, consumed);
      if (start === null) return null;
      if (best === null || start < best.start) best = { lineId, order, start, end: start + duration };
    }
    if (best === null) return null;
    placed.push({ orderId: best.order.orderId, lineId: best.lineId, startHour: best.start, endHour: best.end, partFamily: best.order.partFamily });
    cursors.set(best.lineId, { free: best.end, lastFamily: best.order.partFamily });
    heads.set(best.lineId, heads.get(best.lineId)! + 1);
    for (const b of best.order.bom) {
      consumed.set(b.partNumber, (consumed.get(b.partNumber) ?? 0) + b.qtyPer * best.order.qty);
    }
  }
  return placed;
}

/** Every way to give each order an eligible line and a position in that line's sequence. */
function* assignments(s: FactorySnapshot): Generator<Map<string, Order[]>> {
  const orders = s.orders;
  const sequences = new Map<string, Order[]>(s.lines.map((l) => [l.lineId, []]));
  function* rec(i: number): Generator<Map<string, Order[]>> {
    if (i === orders.length) {
      yield sequences;
      return;
    }
    const order = orders[i];
    for (const line of s.lines) {
      if (line.lineType !== order.lineType) continue;
      const seq = sequences.get(line.lineId)!;
      for (let pos = 0; pos <= seq.length; pos++) {
        seq.splice(pos, 0, order);
        yield* rec(i + 1);
        seq.splice(pos, 1);
      }
    }
  }
  yield* rec(0);
}

const lateness = (placed: readonly Placed[], orders: readonly Order[]) =>
  placed.reduce((sum, p) => {
    const due = orders.find((o) => o.orderId === p.orderId)!.dueHour;
    return sum + Math.max(0, p.endHour - due);
  }, 0);

/** Lower bound per order: the order alone on its best line, right after frozen work. */
function lowerBound(s: FactorySnapshot, trueCt: CycleTimeFn, order: Order): { bound: Hour; reasons: OraclePerOrder["reasonCodes"] } {
  const cursors = initialCursors(s);
  let bound = Infinity;
  const reasons = new Set<ReasonCode>();
  const eligible = s.lines.filter((l) => l.lineType === order.lineType);
  if (eligible.length === 0) return { bound: Infinity, reasons: ["no_eligible_line"] };
  for (const line of eligible) {
    const cursor = cursors.get(line.lineId)!;
    const perUnit = trueCt(line.lineId, order.partFamily);
    if (perUnit === undefined) continue;
    const duration = jobDuration(order, perUnit, cursor.lastFamily);
    const start = earliestStart(s, line, order, duration, cursor.free, new Map());
    // Unplaceable inside the horizon: the bound is the horizon end (a valid
    // lower bound on finishing, since nothing finishes inside the horizon).
    const finish = start === null ? s.horizonHours + duration : start + duration;
    if (finish < bound) bound = finish;
  }
  if (bound > order.dueHour) {
    reasons.add("capacity");
    for (const line of eligible) {
      const cursor = cursors.get(line.lineId)!;
      if (!materialOk(s, order, cursor.free, new Map())) reasons.add("material_arrival");
      if (!fitsAvailability(line, cursor.free, cursor.free + 1e-3)) reasons.add("line_unavailable");
    }
  }
  return { bound, reasons: [...reasons] };
}

export function runOracle(s: FactorySnapshot, trueCt: CycleTimeFn): OracleResult {
  if (s.orders.length > MAX_ORACLE_ORDERS) {
    throw new RangeError(`oracle supports at most ${MAX_ORACLE_ORDERS} movable orders, got ${s.orders.length}`);
  }
  const rush = s.orders.filter((o) => o.rush);
  let witness: Placed[] | null = null;
  let witnessScore: [number, number] | null = null;

  for (const seqs of assignments(s)) {
    const placed = pack(s, trueCt, seqs);
    if (placed === null) continue;
    const rushOnTime = rush.every((o) => {
      const p = placed.find((x) => x.orderId === o.orderId)!;
      return p.endHour <= o.dueHour + EPS;
    });
    if (!rushOnTime) continue;
    // Deterministic choice among feasible schedules: least total lateness, then makespan.
    const score: [number, number] = [lateness(placed, s.orders), Math.max(0, ...placed.map((p) => p.endHour))];
    if (witnessScore === null || score[0] < witnessScore[0] - EPS || (Math.abs(score[0] - witnessScore[0]) <= EPS && score[1] < witnessScore[1] - EPS)) {
      witness = placed.map((p) => ({ ...p }));
      witnessScore = score;
    }
  }

  const perOrder = s.orders.map((o) => {
    const { bound, reasons } = lowerBound(s, trueCt, o);
    const w = witness?.find((p) => p.orderId === o.orderId);
    return {
      orderId: o.orderId,
      earliestFinishGivenWitness: w?.endHour,
      cannotFinishBefore: bound,
      reasonCodes: reasons,
    };
  });

  return {
    allRushOnTimeFeasible: witness !== null,
    witnessSchedule: witness?.map(({ orderId, lineId, startHour, endHour }) => ({ orderId, lineId, startHour, endHour })),
    perOrder,
  };
}
