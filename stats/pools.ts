import { readFileSync } from "node:fs";
import type { DataViewPolicy } from "../checks/guardrails";
import type { Plan } from "../sim/domain";
import { editReasons } from "../sim/reviewer";
import { SCENARIOS, seedScenario } from "../sim/scenarios";
import type { PoolItem } from "./monitorSim";

// Builds the monitor-simulation pools from stats/pools.json (recorded
// rs-1.0 proposals). The monitored operator in the replay is op-v1, and
// the monitored job type is routine reschedules:
//   healthy = op-v1 on routine scenarios where nothing drifted
//   drifted = op-v1 on slow-machine (SMT-2 30% slow, invisible to op-v1)

export const ROUTINE_SCENARIOS = ["shortage", "line-unavailable", "failed-write", "reserved-stock"];

type Exported = { proposals: { operatorVersion: string; scenarioId: string; trialKey: string; dataView: DataViewPolicy; plan: Plan }[] };

export function loadPools(path: string, durationTolerance: number) {
  const data = JSON.parse(readFileSync(path, "utf8")) as Exported;
  const seeded = new Map(SCENARIOS.map((s) => [s.id, seedScenario(s)]));
  const judge = (p: Exported["proposals"][number]): PoolItem => ({
    id: p.trialKey,
    shouldEdit: editReasons(seeded.get(p.scenarioId)!, p.plan, p.dataView, durationTolerance).length > 0,
  });
  const v1 = data.proposals.filter((p) => p.operatorVersion === "op-v1");
  const healthy = v1.filter((p) => ROUTINE_SCENARIOS.includes(p.scenarioId)).map(judge);
  const drifted = v1.filter((p) => p.scenarioId === "slow-machine").map(judge);
  return { healthy, drifted };
}
