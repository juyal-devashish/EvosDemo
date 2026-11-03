import { binomCdf } from "./binomial";

// The monitoring rule (SPEC §10.4), the only automatic autonomy trigger.
// Non-overlapping windows; a window is evaluated once all its reviews are
// complete or `graceDays` after it closes. Pending reviews are shown and
// flagged, never counted as agreement. n < minN is insufficient data.
// Signal if P(X ≤ x | n, p₀) ≤ α.

export type Review = { agreed: boolean } | { pending: true };

export type WindowResult =
  | { status: "insufficientData"; n: number; x: number; pending: number }
  | { status: "ok" | "signal"; n: number; x: number; pending: number; pValue: number };

export function evaluateWindow(reviews: readonly Review[], p: { p0: number; alpha: number; minN: number }): WindowResult {
  const done = reviews.filter((r): r is { agreed: boolean } => !("pending" in r));
  const pending = reviews.length - done.length;
  const n = done.length;
  const x = done.filter((r) => r.agreed).length;
  if (n < p.minN) return { status: "insufficientData", n, x, pending };
  const pValue = binomCdf(x, n, p.p0);
  return { status: pValue <= p.alpha ? "signal" : "ok", n, x, pending, pValue };
}

/** Window index (0-based) for a proposal day (1-based), windows of `windowDays`. */
export const windowOf = (day: number, windowDays: number) => Math.floor((day - 1) / windowDays);

/** Day on which a window is evaluated: when its last review lands, but no later than close + grace. */
export function evaluationDay(windowIndex: number, lastReviewDay: number, p: { windowDays: number; graceDays: number }) {
  const closeDay = (windowIndex + 1) * p.windowDays;
  return Math.min(Math.max(closeDay, lastReviewDay), closeDay + p.graceDays);
}
