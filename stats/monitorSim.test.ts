import { expect, test } from "vitest";
import { MONITOR_CONFIG as C, VALIDATION as V } from "./config";
import { baselineAgreement, replay, type PoolItem } from "./monitorSim";

const healthy: PoolItem[] = Array.from({ length: 40 }, (_, i) => ({ id: `h${i}`, shouldEdit: false }));
const drifted: PoolItem[] = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, shouldEdit: true }));
const base = {
  horizonDays: V.horizonDays,
  routinePerDay: C.routinePerDay,
  driftStartDay: V.driftStartDay,
  pCatch: C.reviewer.pCatch,
  pPicky: C.reviewer.pPicky,
  p0: C.p0,
  alpha: C.alpha,
  minN: C.minN,
  windowDays: C.windowDays,
  graceDays: C.graceDays,
  reviewDelay: V.reviewDelay,
};

test("replays are deterministic for a seed", () => {
  expect(replay({ healthy, drifted }, { ...base, driftRate: 1 }, 7)).toEqual(replay({ healthy, drifted }, { ...base, driftRate: 1 }, 7));
});

test("full drift is detected in the first window that contains it", () => {
  const r = replay({ healthy, drifted }, { ...base, driftRate: 1 }, 7);
  expect(r.signalDay).not.toBeNull();
  expect(r.signalDay!).toBeGreaterThanOrEqual(V.driftStartDay);
  expect(r.signalDay! - V.driftStartDay).toBeLessThanOrEqual(6);
});

test("baseline agreement on a clean pool is about 1 − pPicky", () => {
  expect(baselineAgreement(healthy, C.reviewer, 20_000, 1)).toBeCloseTo(1 - C.reviewer.pPicky, 2);
});
