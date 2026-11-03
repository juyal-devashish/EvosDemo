// Suite verdicts (SPEC §8). Pure: takes trial outcomes, returns the scoped
// verdict. Each trial is judged on its FIRST attempt; retries never replace
// it. Missing trials stay in the denominator and are never passing.

export type TrialOutcome =
  | { scenarioId: string; state: "passed" }
  | { scenarioId: string; state: "failed"; failedChecks: string[] }
  | { scenarioId: string; state: "missing"; reason: string };

export type FailureGroup = { checkId: string; scenarioId: string; failedTrials: number; trials: number };

export type SuiteVerdict = {
  kind: "passed" | "failed" | "incomplete";
  text: string;
  failures: FailureGroup[];
  missing: { count: number; reasons: Record<string, number> };
  /** Per scenario: observed failures and the one-sided 95% upper bound on the failure rate when 0 failed. */
  perScenario: { scenarioId: string; trials: number; passed: number; failed: number; missing: number; upperBound95?: number }[];
};

/** One-sided 95% upper bound on the failure rate after 0 failures in n i.i.d. trials. */
export const zeroFailureUpperBound = (n: number) => 1 - Math.pow(0.05, 1 / n);

export function computeVerdict(args: {
  suiteVersion: string;
  manifestHash: string;
  scenarioIds: readonly string[];
  trialsPerScenario: number;
  trials: readonly TrialOutcome[];
}): SuiteVerdict {
  const expected = args.scenarioIds.length * args.trialsPerScenario;
  // Trials that were never recorded at all also count as missing.
  const unrecorded = expected - args.trials.length;

  const groups = new Map<string, FailureGroup>();
  const reasons: Record<string, number> = {};
  if (unrecorded > 0) reasons.not_recorded = unrecorded;
  for (const t of args.trials) {
    if (t.state === "failed") {
      for (const checkId of new Set(t.failedChecks)) {
        const k = `${checkId}|${t.scenarioId}`;
        const g = groups.get(k) ?? { checkId, scenarioId: t.scenarioId, failedTrials: 0, trials: args.trialsPerScenario };
        groups.set(k, { ...g, failedTrials: g.failedTrials + 1 });
      }
    } else if (t.state === "missing") {
      reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
    }
  }
  const failures = [...groups.values()].sort(
    (a, b) => b.failedTrials - a.failedTrials || a.scenarioId.localeCompare(b.scenarioId) || a.checkId.localeCompare(b.checkId),
  );
  const missingCount = Object.values(reasons).reduce((a, b) => a + b, 0);

  const perScenario = args.scenarioIds.map((scenarioId) => {
    const ts = args.trials.filter((t) => t.scenarioId === scenarioId);
    const passed = ts.filter((t) => t.state === "passed").length;
    const failed = ts.filter((t) => t.state === "failed").length;
    const missing = args.trialsPerScenario - passed - failed;
    return {
      scenarioId,
      trials: args.trialsPerScenario,
      passed,
      failed,
      missing,
      ...(failed === 0 && missing === 0 ? { upperBound95: zeroFailureUpperBound(args.trialsPerScenario) } : {}),
    };
  });

  const missingText = `${missingCount} trial${missingCount === 1 ? "" : "s"} missing: ${Object.keys(reasons).sort().join(", ")}`;
  let kind: SuiteVerdict["kind"];
  let text: string;
  if (failures.length > 0) {
    kind = "failed";
    text = `Failed: ${failures.map((g) => `${g.checkId} on ${g.scenarioId}, ${g.failedTrials}/${g.trials} trials`).join("; ")}`;
    if (missingCount > 0) text += ` (also ${missingText})`;
  } else if (missingCount > 0) {
    kind = "incomplete";
    text = `Incomplete (${missingText})`;
  } else {
    kind = "passed";
    text = `Passed ${args.suiteVersion} (${args.scenarioIds.length} scenarios, ${args.trialsPerScenario} trial${args.trialsPerScenario === 1 ? "" : "s"} each, manifest ${args.manifestHash.slice(0, 4)}…)`;
  }
  return { kind, text, failures, missing: { count: missingCount, reasons }, perScenario };
}
