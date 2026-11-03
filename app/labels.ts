// Display labels for structured values. The values themselves always come
// from Convex; these only name them.

export const EXPECTED_OUTCOME: Record<string, string> = {
  plan_passes: "Plan passes all checks",
  escalation_correct: "Escalate with a correct bound",
  escalation_present: "Escalate; no date on stale data",
  matches_priority_rule: "Follow the priority rule",
  failure_handled: "Report failure; no state change",
};

export const CHECK: Record<string, string> = {
  G1: "No overlap",
  G2: "Material conservation",
  G3: "Line type",
  G4: "Line availability",
  G5: "Schema valid",
  G6: "In scope",
  G7: "Duration ≥ routing standard",
  G8: "Data freshness",
  C1: "Rush orders on time when feasible",
  C2: "Infeasible order escalated with bound",
  C3: "Every order has a disposition",
  C4: "Durations match true cycle times (±5%)",
  T1: "Commitments match the schedule",
  PRIORITY: "Priority rule",
  ESCALATION: "Expected escalation",
  FAILED_WRITE: "Failed write handled",
  ATTEMPT_REFUSAL: "Model refused",
  ATTEMPT_PARSE_FAIL: "Unparsable output",
};

export const shortHash = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

export const LEVEL: Record<string, string> = {
  shadow: "Shadow",
  supervised: "Supervised",
  limited: "Limited autonomy",
  demoted: "Demoted (supervised)",
};
