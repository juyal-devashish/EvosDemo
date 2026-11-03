import type { DataSource, FactorySnapshot } from "../sim/domain";
import { dataAgeShifts, POLICY_MAX_DATA_AGE_SHIFTS } from "../sim/model";
import type { Provenance } from "../checks/truth";
import type { DataViewPolicy } from "../checks/guardrails";

// Builds exactly what the model sees from the factory snapshot, under the
// manifest's data view, and records server-side provenance (sources and
// their server-computed ages). The model's own claims about its sources
// are never trusted (SPEC §6, T4).

export type OperatorInput = {
  /** Serialized into the user message. */
  payload: Record<string, unknown>;
  provenance: Provenance;
};

/** Mean observed hours/unit per (line, family), with the observation count. */
function summarizeMes(s: FactorySnapshot) {
  const acc = new Map<string, { lineId: string; partFamily: string; total: number; n: number }>();
  for (const o of s.mesObservations) {
    const k = `${o.lineId}|${o.partFamily}`;
    const a = acc.get(k) ?? { lineId: o.lineId, partFamily: o.partFamily, total: 0, n: 0 };
    acc.set(k, { ...a, total: a.total + o.hoursPerUnit, n: a.n + 1 });
  }
  return [...acc.values()]
    .sort((a, b) => (a.lineId + a.partFamily).localeCompare(b.lineId + b.partFamily))
    .map((a) => ({
      lineId: a.lineId,
      partFamily: a.partFamily,
      observedHoursPerUnit: Math.round((a.total / a.n) * 10000) / 10000,
      observations: a.n,
    }));
}

export function buildOperatorInput(s: FactorySnapshot, dataView: DataViewPolicy): OperatorInput {
  const sources: DataSource[] = ["erp_routing", "erp_stock"];
  if (dataView.includeMesCycleTimes) sources.push("mes_cycle_times");
  const ages = Object.fromEntries(sources.map((src) => [src, dataAgeShifts(s, src)]));

  const payload: Record<string, unknown> = {
    nowShift: s.nowShift,
    horizonHours: s.horizonHours,
    freshnessLimitShifts: dataView.maxDataAgeShifts ?? POLICY_MAX_DATA_AGE_SHIFTS,
    dataAgeShifts: ages,
    lines: s.lines,
    openOrders: s.orders,
    frozenJobs: s.frozenJobs,
    routingStandardCycleTimes: s.standardCycleTimes,
    stock: s.stock,
    confirmedArrivals: s.arrivals.filter((a) => a.confirmed),
    reservations: s.reservations,
  };
  if (dataView.includeMesCycleTimes) payload.observedCycleTimes = summarizeMes(s);

  return {
    payload,
    provenance: { sources: sources.map((source) => ({ source, ageShifts: dataAgeShifts(s, source) })) },
  };
}

export function userMessage(input: OperatorInput): string {
  return `Factory state (JSON):\n${JSON.stringify(input.payload)}\n\nPropose the plan.`;
}
