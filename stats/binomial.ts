// Binomial tail and Clopper–Pearson bounds (SPEC §10.4, §10.6). Exact
// sums in log space; no approximations.

function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

export function binomPmf(k: number, n: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/** P(X ≤ x) for X ~ Binomial(n, p). */
export function binomCdf(x: number, n: number, p: number): number {
  if (x < 0) return 0;
  if (x >= n) return 1;
  let s = 0;
  for (let k = 0; k <= x; k++) s += binomPmf(k, n, p);
  return Math.min(1, s);
}

/** Root of a monotone function on [0, 1] by bisection. */
function bisect(f: (p: number) => number, target: number, increasing: boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const below = f(mid) < target;
    if (below === increasing) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * One-sided Clopper–Pearson lower bound at confidence 1 − alpha: the p
 * where P(X ≥ x | n, p) = alpha. 0 when x = 0.
 */
export function clopperPearsonLower(x: number, n: number, alpha = 0.05): number {
  if (x <= 0) return 0;
  return bisect((p) => 1 - binomCdf(x - 1, n, p), alpha, true);
}

/** One-sided Clopper–Pearson upper bound: the p where P(X ≤ x | n, p) = alpha. 1 when x = n. */
export function clopperPearsonUpper(x: number, n: number, alpha = 0.05): number {
  if (x >= n) return 1;
  return bisect((p) => binomCdf(x, n, p), alpha, false);
}

/** Two-sided 95% Clopper–Pearson interval, for reporting rates. */
export function clopperPearson95(x: number, n: number): [number, number] {
  return [clopperPearsonLower(x, n, 0.025), clopperPearsonUpper(x, n, 0.025)];
}
