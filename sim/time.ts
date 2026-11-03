import type { Hour, Shift } from "./domain";
import { HOURS_PER_SHIFT, HORIZON_SHIFTS } from "./domain";

/** Shift index (0-based, across the horizon) that contains hour `h`. */
export function shiftIndexOf(h: Hour): number {
  return Math.floor(h / HOURS_PER_SHIFT);
}

/** `(day, shift)` label for a shift index. Two shifts (A, B) per day, days 1-based. */
export function shiftOf(index: number): Shift {
  if (!Number.isInteger(index) || index < 0 || index >= HORIZON_SHIFTS) {
    throw new RangeError(`shift index out of horizon: ${index}`);
  }
  return { day: Math.floor(index / 2) + 1, shift: index % 2 === 0 ? "A" : "B" };
}
