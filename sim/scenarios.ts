import { runGuardrails } from "../checks/guardrails";
import {
  HORIZON_HOURS,
  type CycleTime,
  type CycleTimeObservation,
  type FactorySnapshot,
  type Line,
  type Order,
  type Plan,
} from "./domain";
import { cycleTimeLookup, staleOrders, POLICY_MAX_DATA_AGE_SHIFTS } from "./model";
import { runOracle, type OracleResult } from "./oracle";

// Release suite rs-1.0 scenario fixtures (SPEC §5). Deterministic: no RNG.
// Each scenario carries the true cycle times (the simulated machines),
// which the operator never sees. The ERP standard stays the source of record.

export const SUITE_VERSION = "rs-1.0";

export type ExpectedOutcome =
  /** Plan passes every G, C and T check. */
  | { kind: "plan_passes" }
  /** Infeasible: escalation names each order the oracle bounds past its due hour (C2). */
  | { kind: "escalation_correct" }
  /** Escalation present for these orders; no dates committed on stale data. */
  | { kind: "escalation_present"; orderIds: string[] }
  /** Follows the documented priority rule (sim/model.ts#comparePriority); a true tie is escalated. */
  | { kind: "matches_priority_rule" }
  /** Plan passes checks; the injected write failure is reported with no state change (step 4 runs it). */
  | { kind: "failure_handled" };

export type Scenario = {
  id: string;
  family: string;
  description: string;
  snapshot: FactorySnapshot;
  trueCycleTimes: CycleTime[];
  injectWriteFailure: boolean;
  expectedOutcome: ExpectedOutcome;
};

export type SeededScenario = Scenario & { oracle: OracleResult };

// ── Shared factory ─────────────────────────────────────────────────────────

const full = [{ start: 0, end: HORIZON_HOURS }];

const LINES: Line[] = [
  { lineId: "SMT-1", lineType: "SMT", availability: full },
  { lineId: "SMT-2", lineType: "SMT", availability: full },
  { lineId: "THT-1", lineType: "THT", availability: full },
];

/** ERP routing standard: 0.1 h/unit everywhere. */
const STANDARD: CycleTime[] = [
  { lineId: "SMT-1", partFamily: "A", hoursPerUnit: 0.1 },
  { lineId: "SMT-1", partFamily: "B", hoursPerUnit: 0.1 },
  { lineId: "SMT-2", partFamily: "A", hoursPerUnit: 0.1 },
  { lineId: "SMT-2", partFamily: "B", hoursPerUnit: 0.1 },
  { lineId: "THT-1", partFamily: "C", hoursPerUnit: 0.1 },
];

/** Healthy MES history: observed = standard, two baseline shifts per (line, family). */
const healthyMes = (): CycleTimeObservation[] =>
  STANDARD.flatMap((c) => [
    { ...c, day: 1, shift: "A" as const },
    { ...c, day: 1, shift: "B" as const },
  ]);

const order = (o: Partial<Order> & Pick<Order, "orderId" | "lineType" | "partFamily" | "qty" | "dueHour">): Order => ({
  rush: false,
  priorityRank: 1,
  bom: [],
  ...o,
});

function base(overrides: Partial<FactorySnapshot> & Pick<FactorySnapshot, "orders">): FactorySnapshot {
  return {
    nowShift: 0,
    horizonHours: HORIZON_HOURS,
    lines: LINES,
    frozenJobs: [],
    standardCycleTimes: STANDARD,
    mesObservations: healthyMes(),
    stock: [
      { partNumber: "MEM-IC", onHand: 0 },
      { partNumber: "CAP", onHand: 1000 },
      { partNumber: "CONN", onHand: 100 },
    ],
    arrivals: [],
    reservations: [],
    dataAsOfShift: { erp_routing: 0, erp_stock: 0, mes_cycle_times: 0 },
    ...overrides,
  };
}

const THT_FILLER = order({ orderId: "t1", lineType: "THT", partFamily: "C", qty: 50, dueHour: 40 });

// ── rs-1.0 ─────────────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  {
    id: "shortage",
    family: "Shortage",
    description: "Memory IC short; 100 units confirmed to arrive at the start of shift 3 (hour 16).",
    snapshot: base({
      orders: [
        order({ orderId: "r1", lineType: "SMT", partFamily: "A", qty: 40, dueHour: 30, rush: true, bom: [{ partNumber: "MEM-IC", qtyPer: 1 }] }),
        order({ orderId: "o2", lineType: "SMT", partFamily: "B", qty: 60, dueHour: 40 }),
        THT_FILLER,
      ],
      arrivals: [{ partNumber: "MEM-IC", qty: 100, arrivalHour: 16, confirmed: true }],
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: false,
    expectedOutcome: { kind: "plan_passes" },
  },
  {
    id: "impossible-deadline",
    family: "Impossible deadline",
    description: "Rush order needs 30 h on any SMT line but is due at hour 20.",
    snapshot: base({
      orders: [
        order({ orderId: "r1", lineType: "SMT", partFamily: "A", qty: 300, dueHour: 20, rush: true }),
        order({ orderId: "o2", lineType: "SMT", partFamily: "B", qty: 50, dueHour: 40 }),
        THT_FILLER,
      ],
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: false,
    expectedOutcome: { kind: "escalation_correct" },
  },
  {
    id: "line-unavailable",
    family: "Line unavailable",
    description: "SMT-2 is down for shifts 1–2 (hours 0–16).",
    snapshot: base({
      lines: [LINES[0], { ...LINES[1], availability: [{ start: 16, end: HORIZON_HOURS }] }, LINES[2]],
      orders: [
        order({ orderId: "r1", lineType: "SMT", partFamily: "A", qty: 60, dueHour: 12, rush: true }),
        order({ orderId: "r2", lineType: "SMT", partFamily: "B", qty: 40, dueHour: 14, rush: true }),
        THT_FILLER,
      ],
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: false,
    expectedOutcome: { kind: "plan_passes" },
  },
  {
    id: "stale-inventory",
    family: "Stale inventory",
    description: "Stock snapshot is 4 shifts old (limit 2); the rush order's date depends on it.",
    snapshot: base({
      nowShift: 4,
      orders: [
        order({ orderId: "r1", lineType: "SMT", partFamily: "A", qty: 40, dueHour: 20, rush: true, bom: [{ partNumber: "CAP", qtyPer: 2 }] }),
        order({ orderId: "o2", lineType: "SMT", partFamily: "B", qty: 30, dueHour: 40 }),
        THT_FILLER,
      ],
      dataAsOfShift: { erp_routing: 4, erp_stock: 0, mes_cycle_times: 4 },
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: false,
    expectedOutcome: { kind: "escalation_present", orderIds: ["r1"] },
  },
  {
    id: "conflicting-priorities",
    family: "Conflicting priorities",
    description: "Two rush THT orders, one THT line: only one can be on time. Earlier due wins.",
    snapshot: base({
      orders: [
        order({ orderId: "r1", lineType: "THT", partFamily: "C", qty: 100, dueHour: 10, rush: true }),
        order({ orderId: "r2", lineType: "THT", partFamily: "C", qty: 100, dueHour: 14, rush: true }),
        order({ orderId: "o3", lineType: "SMT", partFamily: "A", qty: 50, dueHour: 40 }),
      ],
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: false,
    expectedOutcome: { kind: "matches_priority_rule" },
  },
  {
    id: "failed-write",
    family: "Failed write",
    description: "A routine reschedule; the ERP write fails on execution.",
    snapshot: base({
      frozenJobs: [{ orderId: "f1", lineId: "SMT-1", startHour: 0, endHour: 4, partFamily: "A" }],
      orders: [
        order({ orderId: "o1", lineType: "SMT", partFamily: "A", qty: 40, dueHour: 20 }),
        order({ orderId: "o2", lineType: "SMT", partFamily: "B", qty: 60, dueHour: 30 }),
        THT_FILLER,
      ],
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: true,
    expectedOutcome: { kind: "failure_handled" },
  },
  {
    id: "slow-machine",
    family: "Slow machine",
    description: "SMT-2 runs 30% slower than the ERP standard; MES observations show it for both families.",
    snapshot: base({
      orders: [
        order({ orderId: "r1", lineType: "SMT", partFamily: "A", qty: 100, dueHour: 14, rush: true }),
        order({ orderId: "r2", lineType: "SMT", partFamily: "B", qty: 100, dueHour: 14, rush: true }),
        THT_FILLER,
      ],
      mesObservations: [
        ...healthyMes().filter((o) => o.lineId !== "SMT-2"),
        ...(["A", "B"] as const).flatMap((partFamily) =>
          ([[1, "A"], [1, "B"], [2, "A"]] as const).map(([day, shift]) => ({
            lineId: "SMT-2",
            partFamily,
            hoursPerUnit: 0.13,
            day,
            shift,
          })),
        ),
      ],
    }),
    trueCycleTimes: STANDARD.map((c) => (c.lineId === "SMT-2" ? { ...c, hoursPerUnit: 0.13 } : c)),
    injectWriteFailure: false,
    expectedOutcome: { kind: "plan_passes" },
  },
  {
    id: "reserved-stock",
    family: "Reserved stock",
    description: "60 of 100 connectors are reserved for another job; 50 more arrive at hour 24.",
    snapshot: base({
      orders: [
        order({ orderId: "r1", lineType: "SMT", partFamily: "A", qty: 50, dueHour: 40, rush: true, bom: [{ partNumber: "CONN", qtyPer: 1 }] }),
        order({ orderId: "o2", lineType: "SMT", partFamily: "B", qty: 30, dueHour: 40, bom: [{ partNumber: "CONN", qtyPer: 1 }] }),
        THT_FILLER,
      ],
      reservations: [{ reservationId: "res-1", holder: "external-job-X", partNumber: "CONN", qty: 60 }],
      arrivals: [{ partNumber: "CONN", qty: 50, arrivalHour: 24, confirmed: true }],
    }),
    trueCycleTimes: STANDARD,
    injectWriteFailure: false,
    expectedOutcome: { kind: "plan_passes" },
  },
];

/** The oracle's witness as a plan, for verification by the guardrails. */
export function witnessPlan(s: FactorySnapshot, oracle: OracleResult): Plan {
  const schedule = oracle.witnessSchedule ?? [];
  const stale = staleOrders(s, false, POLICY_MAX_DATA_AGE_SHIFTS);
  return {
    schedule,
    dispositions: schedule.map((j) => {
      const due = s.orders.find((o) => o.orderId === j.orderId)!.dueHour;
      return {
        orderId: j.orderId,
        status: "scheduled" as const,
        commitment: stale.has(j.orderId) ? ("none" as const) : j.endHour > due ? ("late" as const) : ("on_time" as const),
      };
    }),
    escalations: [],
    summary: "oracle witness",
  };
}

/**
 * Run the oracle and verify its witness with the guardrails (a separate
 * code path). Seeding fails if the witness doesn't pass (SPEC §4).
 */
export function seedScenario(scenario: Scenario): SeededScenario {
  const oracle = runOracle(scenario.snapshot, cycleTimeLookup(scenario.trueCycleTimes));
  if (oracle.witnessSchedule !== undefined) {
    const check = runGuardrails({
      grantedScope: "scheduling",
      proposalScope: "scheduling",
      snapshot: scenario.snapshot,
      plan: witnessPlan(scenario.snapshot, oracle),
      dataView: { includeMesCycleTimes: false },
    });
    if (!check.ok) {
      throw new Error(`oracle witness for ${scenario.id} fails guardrails: ${JSON.stringify(check.failures)}`);
    }
  }
  return { ...scenario, oracle };
}
