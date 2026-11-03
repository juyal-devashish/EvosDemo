import { describe, expect, test } from "vitest";
import { computeVerdict, zeroFailureUpperBound, type TrialOutcome } from "./verdict";

const SCENARIOS = ["a", "slow-machine"];
const all = (state: "passed", n = 10): TrialOutcome[] =>
  SCENARIOS.flatMap((scenarioId) => Array.from({ length: n }, () => ({ scenarioId, state })));
const base = { suiteVersion: "rs-1.0", manifestHash: "ab12cd34", scenarioIds: SCENARIOS, trialsPerScenario: 10 };

describe("computeVerdict", () => {
  test("passed, scoped to suite, size and manifest", () => {
    const v = computeVerdict({ ...base, trials: all("passed") });
    expect(v.kind).toBe("passed");
    expect(v.text).toBe("Passed rs-1.0 (2 scenarios, 10 trials each, manifest ab12…)");
    expect(v.perScenario[0].upperBound95).toBeCloseTo(0.2589, 3);
  });

  test("failed names the check, scenario and count", () => {
    const trials: TrialOutcome[] = [
      ...all("passed").filter((t) => t.scenarioId === "a"),
      ...Array.from({ length: 10 }, () => ({ scenarioId: "slow-machine", state: "failed" as const, failedChecks: ["C4", "C4"] })),
    ];
    const v = computeVerdict({ ...base, trials });
    expect(v.kind).toBe("failed");
    expect(v.text).toBe("Failed: C4 on slow-machine, 10/10 trials");
    expect(v.perScenario.find((s) => s.scenarioId === "slow-machine")!.upperBound95).toBeUndefined();
  });

  test("missing trials are counted, never dropped, and make the suite incomplete", () => {
    const trials: TrialOutcome[] = all("passed").map((t, i) => (i < 12 ? { scenarioId: t.scenarioId, state: "missing", reason: "budget" } : t));
    const v = computeVerdict({ ...base, trials });
    expect(v.kind).toBe("incomplete");
    expect(v.text).toBe("Incomplete (12 trials missing: budget)");
  });

  test("trials never recorded at all count as missing", () => {
    const v = computeVerdict({ ...base, trials: all("passed").slice(0, 15) });
    expect(v).toMatchObject({ kind: "incomplete", missing: { count: 5, reasons: { not_recorded: 5 } } });
  });

  test("failures take precedence and still report missing trials", () => {
    const trials: TrialOutcome[] = [
      { scenarioId: "a", state: "failed", failedChecks: ["G5"] },
      { scenarioId: "a", state: "missing", reason: "timeout" },
      ...all("passed").slice(2),
    ];
    expect(computeVerdict({ ...base, trials }).text).toBe("Failed: G5 on a, 1/10 trials (also 1 trial missing: timeout)");
  });

  test("0/n upper bound matches 1 − 0.05^(1/n)", () => {
    expect(zeroFailureUpperBound(10)).toBeCloseTo(0.2589, 4);
    expect(zeroFailureUpperBound(80)).toBeCloseTo(0.0368, 4);
  });
});
