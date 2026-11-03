// EWMA chart for SMT-2 cycle time per part family (SPEC §10.4). Context
// only: it is never an autonomy trigger. λ = 0.2, L = 3; μ and σ come from
// the first `baselineShifts` points; one point per shift.

export type EwmaPoint = { index: number; value: number; z: number; ucl: number; lcl: number; outOfControl: boolean };

export function ewmaChart(values: readonly number[], opts: { lambda: number; L: number; baselineShifts: number }): EwmaPoint[] {
  const base = values.slice(0, opts.baselineShifts);
  if (base.length < 2) throw new RangeError("need at least 2 baseline points");
  const mu = base.reduce((a, b) => a + b, 0) / base.length;
  const sigma = Math.sqrt(base.reduce((a, b) => a + (b - mu) ** 2, 0) / (base.length - 1));
  const { lambda, L } = opts;
  let z = mu;
  return values.map((value, i) => {
    z = lambda * value + (1 - lambda) * z;
    const t = i + 1;
    const width = L * sigma * Math.sqrt((lambda / (2 - lambda)) * (1 - (1 - lambda) ** (2 * t)));
    return { index: i, value, z, ucl: mu + width, lcl: mu - width, outOfControl: z > mu + width || z < mu - width };
  });
}
