// Plain-language numbers for people who aren't statisticians. Never
// scientific notation: "2.5e-26" becomes "less than 0.0001%".

/** A fraction (0–1) as a percentage: 0.9688 → "97%", 0.00135 → "0.135%". */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  return `${Number(pct.toPrecision(3))}%`;
}

/** A probability of "this happened by luck". Anything below one in a million reads as "less than 0.0001%". */
export function formatChance(p: number): string {
  return p < 1e-6 ? "less than 0.0001%" : formatPercent(p);
}

/** "0 of 17 (0%)". */
export function formatCount(x: number, n: number): string {
  return `${x} of ${n} (${formatPercent(n === 0 ? 0 : x / n)})`;
}
