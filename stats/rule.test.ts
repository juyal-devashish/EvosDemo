import { expect, test } from "vitest";
import { ewmaChart } from "./ewma";
import { evaluateWindow, evaluationDay, windowOf } from "./rule";

const P = { p0: 0.97, alpha: 0.00135, minN: 15 };
const reviews = (agree: number, disagree: number, pending = 0) => [
  ...Array.from({ length: agree }, () => ({ agreed: true })),
  ...Array.from({ length: disagree }, () => ({ agreed: false })),
  ...Array.from({ length: pending }, () => ({ pending: true as const })),
];

test("n < 15 → insufficient data, not tested", () => {
  expect(evaluateWindow(reviews(2, 12), P)).toMatchObject({ status: "insufficientData", n: 14 });
});

test("healthy agreement → ok; collapsed agreement → signal", () => {
  expect(evaluateWindow(reviews(17, 1), P).status).toBe("ok");
  expect(evaluateWindow(reviews(4, 14), P).status).toBe("signal");
});

test("signals exactly at the α boundary", () => {
  // For n = 18, p0 = 0.97: P(X ≤ 14) ≈ 0.0019 > α, P(X ≤ 13) ≈ 0.00016 ≤ α.
  expect(evaluateWindow(reviews(14, 4), P).status).toBe("ok");
  expect(evaluateWindow(reviews(13, 5), P).status).toBe("signal");
});

test("pending reviews are never counted as agreement", () => {
  const r = evaluateWindow(reviews(3, 12, 10), P);
  expect(r).toMatchObject({ n: 15, x: 3, pending: 10, status: "signal" });
  // Same 15 decided reviews; pending ones don't dilute the disagreement.
  expect(evaluateWindow(reviews(3, 12), P)).toMatchObject({ n: 15, x: 3, status: "signal" });
});

test("windows and evaluation timing", () => {
  expect([1, 3, 4, 6, 7].map((d) => windowOf(d, 3))).toEqual([0, 0, 1, 1, 2]);
  expect(evaluationDay(0, 2, { windowDays: 3, graceDays: 2 })).toBe(3); // all in before close
  expect(evaluationDay(0, 4, { windowDays: 3, graceDays: 2 })).toBe(4); // waits for the last review
  expect(evaluationDay(0, 9, { windowDays: 3, graceDays: 2 })).toBe(5); // no later than close + 2
});

test("EWMA flags a sustained 30% shift and not the baseline", () => {
  const base = Array.from({ length: 20 }, (_, i) => 0.1 + ((i % 5) - 2) * 0.001);
  const pts = ewmaChart([...base, ...Array(10).fill(0.13)], { lambda: 0.2, L: 3, baselineShifts: 20 });
  expect(pts.slice(0, 20).some((p) => p.outOfControl)).toBe(false);
  expect(pts.slice(20).some((p) => p.outOfControl)).toBe(true);
});
