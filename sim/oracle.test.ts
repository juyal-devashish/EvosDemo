import { describe, expect, test } from "vitest";
import { runGuardrails } from "../checks/guardrails";
import { order, snapshot } from "../checks/testkit";
import { cycleTimeLookup } from "./model";
import { runOracle } from "./oracle";
import { SCENARIOS, seedScenario, witnessPlan } from "./scenarios";

const byId = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const oracleFor = (id: string) => seedScenario(byId(id)).oracle;
const bound = (id: string, orderId: string) =>
  oracleFor(id).perOrder.find((p) => p.orderId === orderId)!.cannotFinishBefore;

describe("oracle on rs-1.0", () => {
  test("every scenario seeds: witness (when present) passes G1–G8", () => {
    for (const s of SCENARIOS) expect(() => seedScenario(s), s.id).not.toThrow();
  });

  test("impossible deadline: infeasible, bound is the 30 h run", () => {
    const o = oracleFor("impossible-deadline");
    expect(o.allRushOnTimeFeasible).toBe(false);
    expect(o.witnessSchedule).toBeUndefined();
    expect(bound("impossible-deadline", "r1")).toBe(30);
    expect(o.perOrder.find((p) => p.orderId === "r1")!.reasonCodes).toContain("capacity");
  });

  test("shortage: feasible only after the arrival at hour 16", () => {
    const o = oracleFor("shortage");
    expect(o.allRushOnTimeFeasible).toBe(true);
    expect(bound("shortage", "r1")).toBe(20);
    expect(o.witnessSchedule!.find((j) => j.orderId === "r1")!.startHour).toBeGreaterThanOrEqual(16);
  });

  test("slow machine: feasible with true times, one rush order on SMT-2 at 13 h", () => {
    const o = oracleFor("slow-machine");
    expect(o.allRushOnTimeFeasible).toBe(true);
    const onSmt2 = o.witnessSchedule!.filter((j) => j.lineId === "SMT-2" && j.orderId.startsWith("r"));
    expect(onSmt2).toHaveLength(1);
    expect(onSmt2[0].endHour - onSmt2[0].startHour).toBeCloseTo(13);
  });

  test("conflicting priorities: infeasible together, each feasible alone", () => {
    const o = oracleFor("conflicting-priorities");
    expect(o.allRushOnTimeFeasible).toBe(false);
    expect(bound("conflicting-priorities", "r1")).toBe(10);
    expect(bound("conflicting-priorities", "r2")).toBe(10);
  });

  test("line unavailable: witness keeps SMT work off SMT-2 during the downtime", () => {
    const w = oracleFor("line-unavailable").witnessSchedule!;
    for (const j of w.filter((x) => x.lineId === "SMT-2")) expect(j.startHour).toBeGreaterThanOrEqual(16);
  });

  test("reserved stock: the rush order can't start before the hour-24 arrival", () => {
    expect(bound("reserved-stock", "r1")).toBe(29);
  });
});

describe("oracle safeguards", () => {
  test("seeding fails when the witness doesn't pass the guardrails", () => {
    // True machines faster than the ERP standard: the witness is shorter
    // than G7 allows, so seeding must refuse it.
    const s = { ...byId("shortage"), id: "bad", trueCycleTimes: byId("shortage").trueCycleTimes.map((c) => ({ ...c, hoursPerUnit: 0.05 })) };
    expect(() => seedScenario(s)).toThrow(/fails guardrails/);
  });

  test("witnessPlan output is guardrail-clean for a plain snapshot", () => {
    const snap = snapshot();
    const o = runOracle(snap, cycleTimeLookup(snap.standardCycleTimes));
    const check = runGuardrails({
      grantedScope: "scheduling",
      proposalScope: "scheduling",
      snapshot: snap,
      plan: witnessPlan(snap, o),
      dataView: { includeMesCycleTimes: false },
    });
    expect(check.failures).toEqual([]);
  });

  test("refuses more than 6 movable orders", () => {
    const snap = snapshot({ orders: Array.from({ length: 7 }, (_, i) => order({ orderId: `o${i}` })) });
    expect(() => runOracle(snap, cycleTimeLookup(snap.standardCycleTimes))).toThrow(RangeError);
  });

  test("bounds are lower bounds: no witness job finishes before its order's bound", () => {
    for (const s of SCENARIOS) {
      const o = seedScenario(s).oracle;
      for (const j of o.witnessSchedule ?? []) {
        const b = o.perOrder.find((p) => p.orderId === j.orderId)!.cannotFinishBefore;
        expect(j.endHour, `${s.id}/${j.orderId}`).toBeGreaterThanOrEqual(b - 1e-9);
      }
    }
  });
});
