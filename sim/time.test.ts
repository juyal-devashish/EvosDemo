import { describe, expect, test } from "vitest";
import { HORIZON_HOURS } from "./domain";
import { shiftIndexOf, shiftOf } from "./time";

describe("shift arithmetic", () => {
  test("maps hours to (day, shift)", () => {
    expect(shiftOf(shiftIndexOf(0))).toEqual({ day: 1, shift: "A" });
    expect(shiftOf(shiftIndexOf(8))).toEqual({ day: 1, shift: "B" });
    expect(shiftOf(shiftIndexOf(HORIZON_HOURS - 1))).toEqual({ day: 3, shift: "B" });
  });

  test("rejects shifts outside the horizon", () => {
    expect(() => shiftOf(6)).toThrow(RangeError);
    expect(() => shiftOf(-1)).toThrow(RangeError);
  });
});
