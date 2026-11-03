// FROZEN monitor configuration (SPEC §10.4–10.6). Set before the recorded
// fault-injection session and before any recovery data. Do not retune to
// get a nicer result; any change needs a new validation run and must be
// recorded in plan.md with its commit hash.

export const MONITOR_CONFIG = {
  /** One-sided equivalent of 3σ. */
  alpha: 0.00135,
  windowDays: 3,
  graceDays: 2,
  minN: 15,
  /**
   * Baseline agreement, a plug-in estimate from a separate baseline dataset
   * (scripts/monitor-baseline.ts: 20,000 synthetic reviews of the 40-proposal
   * healthy pool, seed 900001). It is largely designed in by pPicky (1 −
   * 0.03 ≈ 0.97): an assumption, not discovered performance.
   */
  p0: 0.9688,
  /** Synthetic reviewer (§10.2). Labeled everywhere it appears. */
  reviewer: { pCatch: 0.9, pPicky: 0.03, durationTolerance: 0.1 },
  /** EWMA on SMT-2 cycle time: context only, never a trigger. */
  ewma: { lambda: 0.2, L: 3, baselineShifts: 20 },
  /** Recovery (§10.6). */
  recovery: { floor: 0.9, minFreshReviews: 80, confidence: 0.95 },
  /** Volume in the recorded session and the simulation (§10.3). */
  routinePerDay: 6,
} as const;

/** Validation design (§10.5). Frozen with the config. */
export const VALIDATION = {
  horizonDays: 30,
  driftStartDay: 10,
  driftRates: [0.25, 0.5, 1.0],
  replaysPerCondition: 1000,
  seedOffset: 1,
  /** P(review lands 0, 1, 2, 3 days after the proposal). 3-day reviews miss the 2-day grace and show as pending. */
  reviewDelay: [0.5, 0.3, 0.15, 0.05],
} as const;
