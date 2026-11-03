import { clopperPearson95 } from "./binomial";
import { evaluateWindow, evaluationDay, windowOf } from "./rule";
import type { Rng } from "../sim/rng";
import { seededRng } from "../sim/rng";

// Monitor simulation (SPEC §10.1, §10.5): statistics about the MONITOR,
// from resampled recorded proposals plus the synthetic reviewer. It makes
// no claim about AI behavior on new states. Resampled replays are not
// independent AI evaluations; report the unique proposals per pool.

/** One pooled proposal, pre-judged: would a careful reviewer edit it? */
export type PoolItem = { id: string; shouldEdit: boolean };

export type SimParams = {
  horizonDays: number;
  routinePerDay: number;
  driftStartDay: number;
  /** Share of routine proposals affected by the drift once it starts (0 = healthy). */
  driftRate: number;
  pCatch: number;
  pPicky: number;
  p0: number;
  alpha: number;
  minN: number;
  windowDays: number;
  graceDays: number;
  /** P(review lands d days after the proposal), d = 0, 1, 2, … */
  reviewDelay: readonly number[];
};

export type ReplayResult = { signalDay: number | null; signalWindow: number | null; windowsEvaluated: number; pendingAtEvaluation: number };

function sampleDelay(rng: Rng, dist: readonly number[]): number {
  let u = rng();
  for (let d = 0; d < dist.length; d++) {
    u -= dist[d];
    if (u < 0) return d;
  }
  return dist.length - 1;
}

const pick = <T,>(rng: Rng, xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];

export function replay(pools: { healthy: readonly PoolItem[]; drifted: readonly PoolItem[] }, p: SimParams, seed: number): ReplayResult {
  const rng = seededRng(seed);
  type Rec = { day: number; agreed: boolean; reviewDay: number };
  const byWindow = new Map<number, Rec[]>();
  for (let day = 1; day <= p.horizonDays; day++) {
    for (let k = 0; k < p.routinePerDay; k++) {
      const drifted = day >= p.driftStartDay && rng() < p.driftRate;
      const item = pick(rng, drifted ? pools.drifted : pools.healthy);
      const edits = item.shouldEdit ? rng() < p.pCatch : rng() < p.pPicky;
      const rec = { day, agreed: !edits, reviewDay: day + sampleDelay(rng, p.reviewDelay) };
      const w = windowOf(day, p.windowDays);
      byWindow.set(w, [...(byWindow.get(w) ?? []), rec]);
    }
  }
  let evaluated = 0;
  let pendingAtEvaluation = 0;
  for (const [w, recs] of [...byWindow.entries()].sort((a, b) => a[0] - b[0])) {
    const evalDay = evaluationDay(w, Math.max(...recs.map((r) => r.reviewDay)), p);
    if (evalDay > p.horizonDays) break;
    const reviews = recs.map((r) => (r.reviewDay <= evalDay ? { agreed: r.agreed } : { pending: true as const }));
    const res = evaluateWindow(reviews, p);
    evaluated++;
    pendingAtEvaluation += res.pending;
    if (res.status === "signal") return { signalDay: evalDay, signalWindow: w, windowsEvaluated: evaluated, pendingAtEvaluation };
  }
  return { signalDay: null, signalWindow: null, windowsEvaluated: evaluated, pendingAtEvaluation };
}

/** Baseline agreement p₀ from a separate set of reviews of the healthy pool (plug-in estimate). */
export function baselineAgreement(healthy: readonly PoolItem[], p: { pCatch: number; pPicky: number }, reviews: number, seed: number): number {
  const rng = seededRng(seed);
  let agreed = 0;
  for (let i = 0; i < reviews; i++) {
    const item = pick(rng, healthy);
    const edits = item.shouldEdit ? rng() < p.pCatch : rng() < p.pPicky;
    if (!edits) agreed++;
  }
  return agreed / reviews;
}

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export type ValidationReport = {
  replaysPerCondition: number;
  falseDemotion: { count: number; rate: number; ci95: [number, number] };
  detection: {
    driftRate: number;
    detected: number;
    rate: number;
    ci95: [number, number];
    delayDays: { median: number | null; p90: number | null };
    notDetectedByHorizon: number;
  }[];
};

export function validate(
  pools: { healthy: readonly PoolItem[]; drifted: readonly PoolItem[] },
  base: Omit<SimParams, "driftRate">,
  driftRates: readonly number[],
  replays: number,
  seedOffset: number,
): ValidationReport {
  let falseCount = 0;
  for (let s = 0; s < replays; s++) {
    if (replay(pools, { ...base, driftRate: 0 }, seedOffset + s).signalDay !== null) falseCount++;
  }
  const detection = driftRates.map((driftRate, ri) => {
    const delays: number[] = [];
    let detected = 0;
    for (let s = 0; s < replays; s++) {
      const r = replay(pools, { ...base, driftRate }, seedOffset + (ri + 1) * 1_000_000 + s);
      // A signal before the drift starts is a false alarm, not a detection.
      if (r.signalDay !== null && r.signalDay >= base.driftStartDay) {
        detected++;
        delays.push(r.signalDay - base.driftStartDay);
      }
    }
    return {
      driftRate,
      detected,
      rate: detected / replays,
      ci95: clopperPearson95(detected, replays),
      delayDays: { median: quantile(delays, 0.5), p90: quantile(delays, 0.9) },
      notDetectedByHorizon: replays - detected,
    };
  });
  return {
    replaysPerCondition: replays,
    falseDemotion: { count: falseCount, rate: falseCount / replays, ci95: clopperPearson95(falseCount, replays) },
    detection,
  };
}
