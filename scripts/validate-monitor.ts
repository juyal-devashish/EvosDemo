// Monitor validation report (SPEC §10.5). Uses the FROZEN config and
// writes stats/validation-report.json. Deterministic (seeded).
//   npm run validate:monitor
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { MONITOR_CONFIG as C, VALIDATION as V } from "../stats/config";
import { validate } from "../stats/monitorSim";
import { loadPools } from "../stats/pools";

const pools = loadPools("stats/pools.json", C.reviewer.durationTolerance);
const report = validate(
  pools,
  {
    horizonDays: V.horizonDays,
    routinePerDay: C.routinePerDay,
    driftStartDay: V.driftStartDay,
    pCatch: C.reviewer.pCatch,
    pPicky: C.reviewer.pPicky,
    p0: C.p0,
    alpha: C.alpha,
    minN: C.minN,
    windowDays: C.windowDays,
    graceDays: C.graceDays,
    reviewDelay: V.reviewDelay,
  },
  V.driftRates,
  V.replaysPerCondition,
  V.seedOffset,
);

const out = {
  label: "Monitor simulation: resampled recorded proposals + synthetic reviewer. Not independent AI evaluations.",
  configCommit: execSync("git log -1 --format=%H -- stats/config.ts").toString().trim(),
  config: C,
  validation: V,
  pools: {
    healthy: { uniqueProposals: pools.healthy.length, shouldEdit: pools.healthy.filter((x) => x.shouldEdit).length },
    drifted: { uniqueProposals: pools.drifted.length, shouldEdit: pools.drifted.filter((x) => x.shouldEdit).length },
  },
  report,
};
writeFileSync("stats/validation-report.json", JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ falseDemotion: report.falseDemotion, detection: report.detection }, null, 1));
