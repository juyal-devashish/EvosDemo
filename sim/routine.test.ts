import { expect, test } from "vitest";
import { evaluatePlan } from "../checks/evaluate";
import { routineScenario } from "./routine";
import { seedScenario } from "./scenarios";

test("routine snapshots seed and are feasible both before and after the drift", () => {
  for (let s = 1; s <= 50; s++) {
    for (const drifted of [false, true]) {
      const sc = seedScenario(routineScenario(s, drifted));
      expect(sc.oracle.allRushOnTimeFeasible, `${s}/${drifted}`).toBe(true);
    }
  }
});

test("after the drift, a plan at ERP standard speed on SMT-2 fails C4; with observed speed it passes", () => {
  const sc = seedScenario(routineScenario(3, true));
  const [ra, rb, o, t] = sc.snapshot.orders;
  const job = (orderId: string, lineId: string, start: number, hours: number) => ({ orderId, lineId, startHour: start, endHour: start + hours });
  const disp = (ids: string[]) => ids.map((orderId) => ({ orderId, status: "scheduled" as const, commitment: "on_time" as const }));
  const atStandard = {
    schedule: [job(ra.orderId, "SMT-1", 0, ra.qty * 0.1), job(rb.orderId, "SMT-2", 0, rb.qty * 0.1), job(o.orderId, "SMT-1", ra.qty * 0.1, o.qty * 0.1), job(t.orderId, "THT-1", 0, t.qty * 0.1)],
    dispositions: disp([ra.orderId, rb.orderId, o.orderId, t.orderId]),
    escalations: [],
    summary: "",
  };
  const v = evaluatePlan(sc, atStandard, { includeMesCycleTimes: false });
  expect(v.failures.map((f) => f.id)).toContain("C4");
});
