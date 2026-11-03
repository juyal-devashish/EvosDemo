import { GUARDRAIL_VERSION } from "../checks/guardrails";
import { SUITE_VERSION } from "../sim/scenarios";
import { canonicalJson, sha256Hex } from "./hash";
import { SYSTEM_PROMPT } from "./prompt";

// Operator manifests (SPEC §6). The hash covers every field, so any change
// (prompt, model, effort, data view, versions) is a new manifest, and a new
// manifest never inherits permissions.

export const POLICY_VERSION = "p-1.0";

export type ManifestBody = {
  operatorVersion: string;
  promptHash: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  dataView: { includeMesCycleTimes: boolean; maxDataAgeShifts?: number };
  guardrailVersion: string;
  policyVersion: string;
  suiteVersion: string;
  scope: "scheduling";
};

export type Manifest = ManifestBody & { manifestHash: string };

export const promptHash = () => sha256Hex(SYSTEM_PROMPT);

export async function hashManifest(body: ManifestBody): Promise<Manifest> {
  return { ...body, manifestHash: await sha256Hex(canonicalJson(body)) };
}

const common = {
  model: "claude-opus-5-5",
  effort: "low" as const,
  // Opus 5.5 always thinks, and thinking counts toward max_tokens. The plan
  // itself is small; this leaves room for low-effort thinking. Revisit after
  // the cost pilot.
  maxTokens: 6000,
  guardrailVersion: GUARDRAIL_VERSION,
  policyVersion: POLICY_VERSION,
  suiteVersion: SUITE_VERSION,
  scope: "scheduling" as const,
};

/** op-v1: its data view lacks observed machine cycle times. Expected to fail rs-1.0 on slow-machine. */
export async function opV1(): Promise<Manifest> {
  return hashManifest({ ...common, operatorVersion: "op-v1", promptHash: await promptHash(), dataView: { includeMesCycleTimes: false } });
}

/** op-v2: the fix. Includes MES cycle times, with a 2-shift freshness limit. */
export async function opV2(): Promise<Manifest> {
  return hashManifest({
    ...common,
    operatorVersion: "op-v2",
    promptHash: await promptHash(),
    dataView: { includeMesCycleTimes: true, maxDataAgeShifts: 2 },
  });
}

export async function manifestByVersion(version: string): Promise<Manifest> {
  if (version === "op-v1") return opV1();
  if (version === "op-v2") return opV2();
  throw new Error(`unknown operator version ${version}`);
}
