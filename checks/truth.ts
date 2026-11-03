import { EPS, type DataSource, type FactorySnapshot, type Plan, type ScheduledJob } from "../sim/domain";
import type { DataViewPolicy } from "./guardrails";

// Truth checks (SPEC §7): screen, stored data and executed changes agree.
// T2 (screen = stored values) is checked by Playwright (tests/e2e).

export type TruthCheckId = "T1" | "T3" | "T4";
export type TruthFailure = { id: TruthCheckId; message: string; orderId?: string };

/** T1: each commitment matches the schedule (late iff end > due; held/escalated have `none`). */
export function t1CommitmentsMatch(snapshot: FactorySnapshot, plan: Plan): TruthFailure[] {
  const failures: TruthFailure[] = [];
  for (const d of plan.dispositions) {
    const job = plan.schedule.find((j) => j.orderId === d.orderId);
    const due = snapshot.orders.find((o) => o.orderId === d.orderId)?.dueHour;
    if (d.status !== "scheduled") {
      if (d.commitment !== "none") failures.push({ id: "T1", orderId: d.orderId, message: `${d.status} order has commitment ${d.commitment}` });
      continue;
    }
    if (job === undefined || due === undefined) continue; // G5/G6 report these
    if (d.commitment === "none") continue; // scheduled without a date commitment (e.g. stale data)
    const expected = job.endHour > due + EPS ? "late" : "on_time";
    if (d.commitment !== expected) {
      failures.push({ id: "T1", orderId: d.orderId, message: `commitment ${d.commitment}, schedule says ${expected}` });
    }
  }
  return failures;
}

const sortJobs = (jobs: readonly ScheduledJob[]) =>
  [...jobs]
    .map(({ orderId, lineId, startHour, endHour }) => ({ orderId, lineId, startHour, endHour }))
    .sort((a, b) => a.orderId.localeCompare(b.orderId));

/**
 * T3: execution wrote exactly the authorized revision's diff. After
 * execution, movable jobs equal the revision's schedule and frozen jobs are
 * unchanged. Nothing more, nothing less.
 */
export function t3ExactDiff(
  before: { frozen: readonly ScheduledJob[] },
  after: { frozen: readonly ScheduledJob[]; movable: readonly ScheduledJob[] },
  revisionSchedule: readonly ScheduledJob[],
): TruthFailure[] {
  const failures: TruthFailure[] = [];
  if (JSON.stringify(sortJobs(after.movable)) !== JSON.stringify(sortJobs(revisionSchedule))) {
    failures.push({ id: "T3", message: "movable jobs differ from the authorized revision" });
  }
  if (JSON.stringify(sortJobs(after.frozen)) !== JSON.stringify(sortJobs(before.frozen))) {
    failures.push({ id: "T3", message: "frozen jobs changed" });
  }
  return failures;
}

/** What the server recorded about the data actually sent to the model (step 3 stores it). */
export type Provenance = { sources: { source: DataSource; ageShifts: number }[] };

/**
 * T4: recorded provenance matches the manifest's data view: exactly the
 * sources it requires were sent (ERP routing and stock always, MES cycle
 * times iff the data view includes them), each with a server-computed age.
 */
export function t4ProvenanceMatches(provenance: Provenance, dataView: DataViewPolicy): TruthFailure[] {
  const required = new Set<DataSource>(["erp_routing", "erp_stock"]);
  if (dataView.includeMesCycleTimes) required.add("mes_cycle_times");
  const sent = new Set(provenance.sources.map((s) => s.source));
  const failures: TruthFailure[] = [];
  for (const src of required) {
    if (!sent.has(src)) failures.push({ id: "T4", message: `${src} required by the data view but not sent` });
  }
  for (const src of sent) {
    if (!required.has(src)) failures.push({ id: "T4", message: `${src} sent but not in the data view` });
  }
  for (const s of provenance.sources) {
    if (!Number.isFinite(s.ageShifts) || s.ageShifts < 0) {
      failures.push({ id: "T4", message: `${s.source} has no valid server-computed age` });
    }
  }
  return failures;
}
