import { evaluatePlan } from "../checks/evaluate";
import type { DataViewPolicy } from "../checks/guardrails";
import type { Plan } from "./domain";
import { cycleTimeLookup, jobDuration, predecessorFamilies } from "./model";
import type { Rng } from "./rng";
import type { SeededScenario } from "./scenarios";

// Synthetic reviewer model (SPEC §10.2). Labeled, frozen, and NOT
// independent validation: it depends on the simulation's own truth model.
// It wants to edit a revision when any C or T check fails, or a planned
// duration differs from the true duration by more than `durationTolerance`.
// It catches such a problem with probability pCatch and edits a correct
// plan with probability pPicky. "Agreement" means it did not edit.

export type ReviewerParams = { pCatch: number; pPicky: number; durationTolerance: number };

export type SyntheticReview = { agreed: boolean; shouldEdit: boolean; reasons: string[] };

/** Why a careful reviewer would edit this plan (deterministic; no randomness). */
export function editReasons(scenario: SeededScenario, plan: Plan, dataView: DataViewPolicy, durationTolerance: number): string[] {
  const reasons: string[] = evaluatePlan(scenario, plan, dataView)
    .failures.filter((f) => f.id.startsWith("C") || f.id.startsWith("T"))
    .map((f) => f.id);
  const ct = cycleTimeLookup(scenario.trueCycleTimes);
  const preds = predecessorFamilies(scenario.snapshot, plan.schedule);
  for (const job of plan.schedule) {
    const order = scenario.snapshot.orders.find((o) => o.orderId === job.orderId);
    const perUnit = order && ct(job.lineId, order.partFamily);
    if (!order || perUnit === undefined) continue;
    const truth = jobDuration(order, perUnit, preds.get(job.orderId));
    if (Math.abs(job.endHour - job.startHour - truth) > durationTolerance * truth) reasons.push("DURATION");
  }
  return [...new Set(reasons)];
}

export function syntheticReview(
  scenario: SeededScenario,
  plan: Plan,
  dataView: DataViewPolicy,
  p: ReviewerParams,
  rng: Rng,
): SyntheticReview {
  const reasons = editReasons(scenario, plan, dataView, p.durationTolerance);
  const shouldEdit = reasons.length > 0;
  const edits = shouldEdit ? rng() < p.pCatch : rng() < p.pPicky;
  return { agreed: !edits, shouldEdit, reasons };
}
