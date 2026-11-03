import type { Plan } from "../sim/domain";
import type { SeededScenario } from "../sim/scenarios";
import { runGuardrails, type DataViewPolicy, type GuardrailFailure } from "./guardrails";
import {
  c1RushOnTime,
  c2InfeasibleEscalated,
  c3AllDisposed,
  c4RealisticDurations,
  escalationPresent,
  priorityRule,
  type SuiteCheckFailure,
} from "./suite";
import { t1CommitmentsMatch, type TruthFailure } from "./truth";

// Evaluate one plan against one rs-1.0 scenario. A trial passes only when
// every applicable check passes. The execution half of `failure_handled`
// (failed result, no state change) is evaluated by the suite runner in step 4.

export type CheckFailure = GuardrailFailure | SuiteCheckFailure | TruthFailure;

export type PlanVerdict = { passed: boolean; failures: CheckFailure[] };

export function evaluatePlan(scenario: SeededScenario, plan: Plan, dataView: DataViewPolicy): PlanVerdict {
  const { snapshot, oracle } = scenario;
  const failures: CheckFailure[] = [
    ...runGuardrails({ grantedScope: "scheduling", proposalScope: "scheduling", snapshot, plan, dataView }).failures,
    ...c1RushOnTime(snapshot, plan, oracle, dataView),
    ...c2InfeasibleEscalated(snapshot, plan, oracle),
    ...c3AllDisposed(snapshot, plan),
    ...c4RealisticDurations(snapshot, plan, scenario.trueCycleTimes),
    ...t1CommitmentsMatch(snapshot, plan),
  ];
  const expected = scenario.expectedOutcome;
  if (expected.kind === "matches_priority_rule") failures.push(...priorityRule(snapshot, plan, oracle));
  if (expected.kind === "escalation_present") failures.push(...escalationPresent(plan, expected.orderIds));
  return { passed: failures.length === 0, failures };
}
