import { HORIZON_HOURS, type FactorySnapshot, type Order, type Plan, type ScheduledJob } from "../sim/domain";

// Small fixtures shared by the pure check tests. Not used by production code.

export const job = (orderId: string, lineId: string, startHour: number, endHour: number): ScheduledJob => ({
  orderId,
  lineId,
  startHour,
  endHour,
});

export const order = (o: Partial<Order> & Pick<Order, "orderId">): Order => ({
  lineType: "SMT",
  partFamily: "A",
  qty: 40,
  dueHour: 40,
  rush: false,
  priorityRank: 1,
  bom: [],
  ...o,
});

/** SMT-1, SMT-2, THT-1 fully available; 0.1 h/unit standard; frozen f1 on SMT-1 0–4. */
export function snapshot(overrides: Partial<FactorySnapshot> = {}): FactorySnapshot {
  return {
    nowShift: 0,
    horizonHours: HORIZON_HOURS,
    lines: [
      { lineId: "SMT-1", lineType: "SMT", availability: [{ start: 0, end: HORIZON_HOURS }] },
      { lineId: "SMT-2", lineType: "SMT", availability: [{ start: 0, end: HORIZON_HOURS }] },
      { lineId: "THT-1", lineType: "THT", availability: [{ start: 0, end: HORIZON_HOURS }] },
    ],
    orders: [order({ orderId: "o1" }), order({ orderId: "o2", partFamily: "B" }), order({ orderId: "o3", lineType: "THT", partFamily: "C" })],
    frozenJobs: [{ ...job("f1", "SMT-1", 0, 4), partFamily: "A" }],
    standardCycleTimes: [
      { lineId: "SMT-1", partFamily: "A", hoursPerUnit: 0.1 },
      { lineId: "SMT-1", partFamily: "B", hoursPerUnit: 0.1 },
      { lineId: "SMT-2", partFamily: "A", hoursPerUnit: 0.1 },
      { lineId: "SMT-2", partFamily: "B", hoursPerUnit: 0.1 },
      { lineId: "THT-1", partFamily: "C", hoursPerUnit: 0.1 },
    ],
    mesObservations: [],
    stock: [],
    arrivals: [],
    reservations: [],
    dataAsOfShift: { erp_routing: 0, erp_stock: 0, mes_cycle_times: 0 },
    ...overrides,
  };
}

/** Plan whose dispositions are derived from the schedule: scheduled, on time. */
export const planOf = (schedule: ScheduledJob[], extra: Partial<Plan> = {}): Plan => ({
  schedule,
  dispositions: schedule.map((j) => ({ orderId: j.orderId, status: "scheduled", commitment: "on_time" })),
  escalations: [],
  summary: "test",
  ...extra,
});
