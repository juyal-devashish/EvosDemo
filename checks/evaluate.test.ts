import { describe, expect, test } from "vitest";
import type { Plan } from "../sim/domain";
import { SCENARIOS, seedScenario } from "../sim/scenarios";
import { evaluatePlan } from "./evaluate";
import { job } from "./testkit";
import { t1CommitmentsMatch, t3ExactDiff, t4ProvenanceMatches } from "./truth";

// For every rs-1.0 scenario: a hand-written correct plan passes, and a
// characteristic wrong plan fails on the check that scenario exists for.

const OP_V2_VIEW = { includeMesCycleTimes: true, maxDataAgeShifts: 2 };

type D = Plan["dispositions"][number];
const sched = (orderId: string, commitment: D["commitment"] = "on_time", cannotFinishBefore?: number): D => ({
  orderId,
  status: "scheduled",
  commitment,
  ...(cannotFinishBefore === undefined ? {} : { cannotFinishBefore }),
});
const plan = (schedule: Plan["schedule"], dispositions: D[], escalations: Plan["escalations"] = []): Plan => ({
  schedule,
  dispositions,
  escalations,
  summary: "reference",
});

const T1 = job("t1", "THT-1", 0, 5);

const cases: Record<string, { correct: Plan; wrong: Plan; wrongFailsOn: string }> = {
  shortage: {
    correct: plan([job("r1", "SMT-1", 16, 20), job("o2", "SMT-2", 0, 6), T1], [sched("r1"), sched("o2"), sched("t1")]),
    wrong: plan([job("r1", "SMT-1", 0, 4), job("o2", "SMT-2", 0, 6), T1], [sched("r1"), sched("o2"), sched("t1")]),
    wrongFailsOn: "G2",
  },
  "impossible-deadline": {
    correct: plan(
      [job("r1", "SMT-1", 0, 30), job("o2", "SMT-2", 0, 5), T1],
      [sched("r1", "late", 30), sched("o2"), sched("t1")],
      [{ orderId: "r1", reason: "cannot finish before hour 30; due hour 20" }],
    ),
    // Escalates but understates the bound: claims capacity that doesn't exist.
    wrong: plan(
      [job("r1", "SMT-1", 0, 30), job("o2", "SMT-2", 0, 5), T1],
      [sched("r1", "late", 24), sched("o2"), sched("t1")],
      [{ orderId: "r1", reason: "late" }],
    ),
    wrongFailsOn: "C2",
  },
  "line-unavailable": {
    correct: plan([job("r1", "SMT-1", 0, 6), job("r2", "SMT-1", 6, 10.5), T1], [sched("r1"), sched("r2"), sched("t1")]),
    wrong: plan([job("r1", "SMT-1", 0, 6), job("r2", "SMT-2", 0, 4), T1], [sched("r1"), sched("r2"), sched("t1")]),
    wrongFailsOn: "G4",
  },
  "stale-inventory": {
    correct: plan(
      [job("o2", "SMT-2", 0, 3), T1],
      [{ orderId: "r1", status: "escalated", commitment: "none" }, sched("o2"), sched("t1")],
      [{ orderId: "r1", reason: "stock snapshot is 4 shifts old" }],
    ),
    wrong: plan([job("r1", "SMT-1", 0, 4), job("o2", "SMT-2", 0, 3), T1], [sched("r1"), sched("o2"), sched("t1")]),
    wrongFailsOn: "G8",
  },
  "conflicting-priorities": {
    correct: plan(
      [job("r1", "THT-1", 0, 10), job("r2", "THT-1", 10, 20), job("o3", "SMT-1", 0, 5)],
      [sched("r1"), sched("r2", "late"), sched("o3")],
    ),
    wrong: plan(
      [job("r2", "THT-1", 0, 10), job("r1", "THT-1", 10, 20), job("o3", "SMT-1", 0, 5)],
      [sched("r2"), sched("r1", "late"), sched("o3")],
    ),
    wrongFailsOn: "PRIORITY",
  },
  "failed-write": {
    correct: plan([job("o1", "SMT-1", 4, 8), job("o2", "SMT-2", 0, 6), T1], [sched("o1"), sched("o2"), sched("t1")]),
    wrong: plan([job("o1", "SMT-1", 2, 6), job("o2", "SMT-2", 0, 6), T1], [sched("o1"), sched("o2"), sched("t1")]),
    wrongFailsOn: "G1",
  },
  "slow-machine": {
    correct: plan([job("r1", "SMT-1", 0, 10), job("r2", "SMT-2", 0, 13), T1], [sched("r1"), sched("r2"), sched("t1")]),
    // op-v1's defect: planned at the ERP standard speed. Passes every guardrail.
    wrong: plan([job("r1", "SMT-1", 0, 10), job("r2", "SMT-2", 0, 10), T1], [sched("r1"), sched("r2"), sched("t1")]),
    wrongFailsOn: "C4",
  },
  "reserved-stock": {
    correct: plan([job("r1", "SMT-1", 24, 29), job("o2", "SMT-2", 0, 3), T1], [sched("r1"), sched("o2"), sched("t1")]),
    wrong: plan([job("r1", "SMT-1", 0, 5), job("o2", "SMT-2", 0, 3), T1], [sched("r1"), sched("o2"), sched("t1")]),
    wrongFailsOn: "G2",
  },
};

describe.each(SCENARIOS.map((s) => [s.id, seedScenario(s)] as const))("%s", (id, scenario) => {
  const c = cases[id];

  test("the reference plan passes every check", () => {
    expect(evaluatePlan(scenario, c.correct, OP_V2_VIEW).failures).toEqual([]);
  });

  test(`the characteristic wrong plan fails ${c.wrongFailsOn}`, () => {
    const v = evaluatePlan(scenario, c.wrong, OP_V2_VIEW);
    expect(v.passed).toBe(false);
    expect(v.failures.map((f) => f.id)).toContain(c.wrongFailsOn);
  });
});

test("every rs-1.0 scenario has reference plans", () => {
  expect(Object.keys(cases).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  expect(SCENARIOS).toHaveLength(8);
});

test("slow machine: op-v1's standard-speed plan fails only C4", () => {
  const scenario = seedScenario(SCENARIOS.find((s) => s.id === "slow-machine")!);
  const v = evaluatePlan(scenario, cases["slow-machine"].wrong, { includeMesCycleTimes: false });
  expect(v.failures.map((f) => `${f.id}:${"orderId" in f ? f.orderId : ""}`)).toEqual(["C4:r2"]);
});

test("dropping an order fails C3", () => {
  const scenario = seedScenario(SCENARIOS.find((s) => s.id === "shortage")!);
  const p = cases.shortage.correct;
  const dropped = { ...p, schedule: p.schedule.filter((j) => j.orderId !== "t1"), dispositions: p.dispositions.filter((d) => d.orderId !== "t1") };
  expect(evaluatePlan(scenario, dropped, OP_V2_VIEW).failures.map((f) => f.id)).toEqual(["C3"]);
});

test("feasible rush order left late fails C1", () => {
  const scenario = seedScenario(SCENARIOS.find((s) => s.id === "shortage")!);
  const late = plan([job("r1", "SMT-1", 30, 34), job("o2", "SMT-2", 0, 6), T1], [sched("r1", "late"), sched("o2"), sched("t1")]);
  expect(evaluatePlan(scenario, late, OP_V2_VIEW).failures.map((f) => f.id)).toEqual(["C1"]);
});

describe("truth checks", () => {
  const scenario = seedScenario(SCENARIOS.find((s) => s.id === "conflicting-priorities")!);

  test("T1 fails when a commitment contradicts the schedule", () => {
    const p = cases["conflicting-priorities"].correct;
    const lying = { ...p, dispositions: p.dispositions.map((d) => (d.orderId === "r2" ? { ...d, commitment: "on_time" as const } : d)) };
    expect(t1CommitmentsMatch(scenario.snapshot, lying)).toMatchObject([{ id: "T1", orderId: "r2" }]);
    expect(t1CommitmentsMatch(scenario.snapshot, p)).toEqual([]);
  });

  test("T1 fails when a held order carries a commitment", () => {
    const p = plan([], [{ orderId: "r1", status: "held", commitment: "on_time" }]);
    expect(t1CommitmentsMatch(scenario.snapshot, p)).toMatchObject([{ id: "T1", orderId: "r1" }]);
  });

  test("T3 passes on the exact diff and fails on extra or changed frozen work", () => {
    const frozen = [job("f1", "SMT-1", 0, 4)];
    const rev = [job("o1", "SMT-1", 4, 8)];
    expect(t3ExactDiff({ frozen }, { frozen, movable: rev }, rev)).toEqual([]);
    expect(t3ExactDiff({ frozen }, { frozen, movable: [...rev, job("o9", "SMT-2", 0, 1)] }, rev)).toMatchObject([{ id: "T3" }]);
    expect(t3ExactDiff({ frozen }, { frozen: [], movable: rev }, rev)).toMatchObject([{ id: "T3" }]);
  });

  test("T4 passes when provenance matches the data view and fails otherwise", () => {
    const withMes = {
      sources: [
        { source: "erp_routing" as const, ageShifts: 0 },
        { source: "erp_stock" as const, ageShifts: 1 },
        { source: "mes_cycle_times" as const, ageShifts: 0 },
      ],
    };
    expect(t4ProvenanceMatches(withMes, OP_V2_VIEW)).toEqual([]);
    // op-v1's data view excludes MES: sending it is a mismatch, and so is omitting it for op-v2.
    expect(t4ProvenanceMatches(withMes, { includeMesCycleTimes: false })).toMatchObject([{ id: "T4" }]);
    expect(t4ProvenanceMatches({ sources: withMes.sources.slice(0, 2) }, OP_V2_VIEW)).toMatchObject([{ id: "T4" }]);
  });
});

test("priority rule: a true tie that isn't resolved on time must be escalated", async () => {
  const { priorityRule } = await import("./suite");
  const base = seedScenario(SCENARIOS.find((s) => s.id === "conflicting-priorities")!);
  // Same due hour and rank: a true tie.
  const tied = {
    ...base,
    snapshot: { ...base.snapshot, orders: base.snapshot.orders.map((o) => (o.rush ? { ...o, dueHour: 10 } : o)) },
  };
  const p = plan(
    [job("r1", "THT-1", 0, 10), job("r2", "THT-1", 10, 20), job("o3", "SMT-1", 0, 5)],
    [sched("r1"), sched("r2", "late"), sched("o3")],
  );
  expect(priorityRule(tied.snapshot, p, tied.oracle).map((f) => f.orderId)).toEqual(["r1", "r2"]);
  const escalated = { ...p, escalations: [{ orderId: "r1", reason: "tie" }, { orderId: "r2", reason: "tie" }] };
  expect(priorityRule(tied.snapshot, escalated, tied.oracle)).toEqual([]);
});
