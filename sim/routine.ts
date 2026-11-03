import { HORIZON_HOURS, type CycleTime, type FactorySnapshot, type Order } from "./domain";
import { seededRng } from "./rng";
import type { Scenario } from "./scenarios";

// Routine reschedules for the recorded fault-injection session (SPEC §10.1,
// §10.3). Each decision gets its own deterministic snapshot. Both SMT lines
// are needed to keep the rush work on time, so SMT-2 is always in play.
// After the drift starts, SMT-2 runs 30% slower than the ERP standard; the
// MES observations show it, but op-v1's data view doesn't include them.

export const SMT2_DRIFT_FACTOR = 1.3;

const full = [{ start: 0, end: HORIZON_HOURS }];
const STANDARD: CycleTime[] = [
  { lineId: "SMT-1", partFamily: "A", hoursPerUnit: 0.1 },
  { lineId: "SMT-1", partFamily: "B", hoursPerUnit: 0.1 },
  { lineId: "SMT-2", partFamily: "A", hoursPerUnit: 0.1 },
  { lineId: "SMT-2", partFamily: "B", hoursPerUnit: 0.1 },
  { lineId: "THT-1", partFamily: "C", hoursPerUnit: 0.1 },
];

export function routineScenario(seed: number, drifted: boolean): Scenario {
  const rng = seededRng(seed);
  const qty = (lo: number, hi: number) => lo + 10 * Math.floor(rng() * ((hi - lo) / 10 + 1));
  const a = qty(60, 100);
  const b = qty(60, 100);
  const orders: Order[] = [
    // Two rush SMT jobs due before either line could run both back to back.
    { orderId: `ra${seed}`, lineType: "SMT", partFamily: "A", qty: a, dueHour: 16, rush: true, priorityRank: 1, bom: [] },
    { orderId: `rb${seed}`, lineType: "SMT", partFamily: "B", qty: b, dueHour: 16, rush: true, priorityRank: 2, bom: [] },
    { orderId: `o${seed}`, lineType: "SMT", partFamily: "A", qty: qty(30, 50), dueHour: 44, rush: false, priorityRank: 3, bom: [] },
    { orderId: `t${seed}`, lineType: "THT", partFamily: "C", qty: qty(30, 60), dueHour: 40, rush: false, priorityRank: 4, bom: [] },
  ];
  const trueCycleTimes = STANDARD.map((c) => (drifted && c.lineId === "SMT-2" ? { ...c, hoursPerUnit: c.hoursPerUnit * SMT2_DRIFT_FACTOR } : c));
  const mes = trueCycleTimes.flatMap((c) =>
    ([[1, "A"], [1, "B"], [2, "A"]] as const).map(([day, shift]) => ({ ...c, day, shift })),
  );
  const snapshot: FactorySnapshot = {
    nowShift: 0,
    horizonHours: HORIZON_HOURS,
    lines: [
      { lineId: "SMT-1", lineType: "SMT", availability: full },
      { lineId: "SMT-2", lineType: "SMT", availability: full },
      { lineId: "THT-1", lineType: "THT", availability: full },
    ],
    orders,
    frozenJobs: [],
    standardCycleTimes: STANDARD,
    mesObservations: mes,
    stock: [],
    arrivals: [],
    reservations: [],
    dataAsOfShift: { erp_routing: 0, erp_stock: 0, mes_cycle_times: 0 },
  };
  return {
    id: `routine-${seed}${drifted ? "-drifted" : ""}`,
    family: "Routine reschedule",
    description: drifted ? "Routine reschedule; SMT-2 30% slow" : "Routine reschedule",
    snapshot,
    trueCycleTimes,
    injectWriteFailure: false,
    expectedOutcome: { kind: "plan_passes" },
  };
}
