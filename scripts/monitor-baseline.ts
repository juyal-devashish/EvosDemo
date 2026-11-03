// Prints the baseline agreement p₀ from a separate baseline dataset
// (seeds disjoint from validation). Run once, before freezing config:
//   npx tsx scripts/monitor-baseline.ts
import { baselineAgreement } from "../stats/monitorSim";
import { loadPools } from "../stats/pools";

const REVIEWER = { pCatch: 0.9, pPicky: 0.03, durationTolerance: 0.1 };
const pools = loadPools("stats/pools.json", REVIEWER.durationTolerance);
const p0 = baselineAgreement(pools.healthy, REVIEWER, 20_000, 900_001);
console.log(JSON.stringify({ p0, reviews: 20_000, healthyUnique: pools.healthy.length, healthyShouldEdit: pools.healthy.filter((x) => x.shouldEdit).length, driftedUnique: pools.drifted.length, driftedShouldEdit: pools.drifted.filter((x) => x.shouldEdit).length }));
