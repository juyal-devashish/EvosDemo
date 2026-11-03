import { expect, test } from "vitest";
import { formatChance, formatCount, formatPercent } from "./format";

test("the replay's real numbers read as plain percentages", () => {
  expect(formatChance(2.5155218750391898e-26)).toBe("less than 0.0001%"); // the signalling window
  expect(formatPercent(0.00135)).toBe("0.135%"); // the alarm threshold
  expect(formatPercent(0.9688)).toBe("97%"); // normal agreement
  expect(formatCount(0, 17)).toBe("0 of 17 (0%)");
  expect(formatCount(17, 17)).toBe("17 of 17 (100%)");
});

test("no output ever uses scientific notation", () => {
  for (const p of [0, 1e-30, 1e-7, 1e-6, 0.0004, 0.00135, 0.05, 0.5, 1]) {
    expect(formatChance(p)).not.toMatch(/e[-+]?\d/i);
  }
});

test("zero reviews doesn't divide by zero", () => {
  expect(formatCount(0, 0)).toBe("0 of 0 (0%)");
});
