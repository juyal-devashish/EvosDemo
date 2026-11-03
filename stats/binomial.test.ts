import { expect, test } from "vitest";
import { binomCdf, clopperPearson95, clopperPearsonLower, clopperPearsonUpper } from "./binomial";

test("SPEC §10.6 recovery examples: 77/80 → 0.906 passes, 76/80 → 0.889 fails the 0.90 floor", () => {
  expect(clopperPearsonLower(77, 80)).toBeCloseTo(0.906, 3);
  expect(clopperPearsonLower(76, 80)).toBeCloseTo(0.889, 3);
  expect(clopperPearsonLower(77, 80)).toBeGreaterThanOrEqual(0.9);
  expect(clopperPearsonLower(76, 80)).toBeLessThan(0.9);
});

test("binomial CDF matches known values", () => {
  expect(binomCdf(0, 10, 0.5)).toBeCloseTo(1 / 1024, 12);
  expect(binomCdf(5, 10, 0.5)).toBeCloseTo(638 / 1024, 12);
  expect(binomCdf(10, 10, 0.3)).toBe(1);
});

test("bounds are consistent at the edges", () => {
  expect(clopperPearsonLower(0, 10)).toBe(0);
  expect(clopperPearsonUpper(10, 10)).toBe(1);
  // 0/10 failures: one-sided 95% upper bound ≈ 1 − 0.05^(1/10)
  expect(clopperPearsonUpper(0, 10)).toBeCloseTo(1 - Math.pow(0.05, 0.1), 6);
  const [lo, hi] = clopperPearson95(5, 10);
  expect(lo).toBeLessThan(0.5);
  expect(hi).toBeGreaterThan(0.5);
});
