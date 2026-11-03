import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test } from "vitest";
import { t4ProvenanceMatches } from "../checks/truth";
import { SCENARIOS } from "../sim/scenarios";
import { callOperator, type MessagesClient } from "./call";
import { buildOperatorInput, userMessage } from "./dataView";
import { hashManifest, opV1, opV2 } from "./manifest";
import { BUDGET_CAP_USD, actualCostUsd, maxCostUsd, maxInputTokensFor } from "./pricing";

// No real API calls: the model client is a fake.

const GOOD_PLAN = {
  schedule: [{ orderId: "r1", lineId: "SMT-1", startHour: 16, endHour: 20 }],
  dispositions: [{ orderId: "r1", status: "scheduled", commitment: "on_time" }],
  escalations: [],
  summary: "ok",
};
const USAGE = { input_tokens: 1200, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

function fakeClient(respond: (params: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      create: async (params: Record<string, unknown>) => {
        calls.push(params);
        return respond(params);
      },
    },
  } as unknown as MessagesClient; // test double for the one SDK method used
  return { client, calls };
}

const message = (text: string, stop_reason = "end_turn", extra: Record<string, unknown> = {}) => ({
  content: [{ type: "text", text }],
  stop_reason,
  stop_details: null,
  usage: USAGE,
  ...extra,
});

describe("callOperator", () => {
  test("request comes only from the manifest: model, max_tokens, effort; no sampling, no fallback", async () => {
    const m = await opV2();
    const { client, calls } = fakeClient(() => message(JSON.stringify(GOOD_PLAN)));
    const out = await callOperator(client, m, "hi");
    expect(out.status).toBe("ok");
    const p = calls[0];
    expect(p.model).toBe(m.model);
    expect(p.max_tokens).toBe(m.maxTokens);
    expect((p.output_config as { effort: string }).effort).toBe("low");
    expect((p.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    for (const k of ["temperature", "top_p", "top_k", "fallbacks", "betas", "thinking"]) expect(p).not.toHaveProperty(k);
  });

  test("refusal → recorded as refusal with usage", async () => {
    const { client } = fakeClient(() => message("", "refusal", { stop_details: { type: "refusal", category: "cyber" } }));
    expect(await callOperator(client, await opV2(), "hi")).toMatchObject({ status: "refusal", usage: USAGE, detail: "cyber" });
  });

  test("max_tokens, non-JSON and schema mismatch → parse_fail, usage kept (tokens were billed)", async () => {
    for (const r of [
      message('{"schedule": [', "max_tokens"),
      message("not json"),
      message(JSON.stringify({ ...GOOD_PLAN, dispositions: [{ orderId: "r1", status: "maybe", commitment: "on_time" }] })),
    ]) {
      const { client } = fakeClient(() => r);
      expect(await callOperator(client, await opV2(), "hi")).toMatchObject({ status: "parse_fail", usage: USAGE });
    }
  });

  test("timeout and API errors → no usage (the reservation is kept)", async () => {
    const timeout = fakeClient(() => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    expect(await callOperator(timeout.client, await opV2(), "hi")).toMatchObject({ status: "timeout", usage: null });
    const rate = fakeClient(() => {
      throw new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
    });
    expect(await callOperator(rate.client, await opV2(), "hi")).toMatchObject({ status: "api_error", usage: null });
  });
});

describe("manifests", () => {
  test("hashes are stable and differ between op-v1 and op-v2", async () => {
    const [a, b, c] = await Promise.all([opV1(), opV1(), opV2()]);
    expect(a.manifestHash).toBe(b.manifestHash);
    expect(a.manifestHash).not.toBe(c.manifestHash);
    expect(a.manifestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("op-v1 and op-v2 differ only in version and data view", async () => {
    const { manifestHash: _a, operatorVersion: _b, dataView: dv1, ...rest1 } = await opV1();
    const { manifestHash: _c, operatorVersion: _d, dataView: dv2, ...rest2 } = await opV2();
    void [_a, _b, _c, _d];
    expect(rest1).toEqual(rest2);
    expect(dv1).toEqual({ includeMesCycleTimes: false });
    expect(dv2).toEqual({ includeMesCycleTimes: true, maxDataAgeShifts: 2 });
  });

  test("changing any field changes the hash", async () => {
    const { manifestHash, ...body } = await opV2();
    expect((await hashManifest({ ...body, effort: "medium" })).manifestHash).not.toBe(manifestHash);
    expect((await hashManifest({ ...body, promptHash: "x" })).manifestHash).not.toBe(manifestHash);
  });
});

describe("data view and provenance", () => {
  const slow = SCENARIOS.find((s) => s.id === "slow-machine")!.snapshot;

  test("T4: provenance matches each manifest's data view", async () => {
    for (const m of [await opV1(), await opV2()]) {
      expect(t4ProvenanceMatches(buildOperatorInput(slow, m.dataView).provenance, m.dataView)).toEqual([]);
    }
  });

  test("op-v1 never sees MES cycle times; op-v2 sees SMT-2 at 0.13 h/unit", async () => {
    const v1 = buildOperatorInput(slow, (await opV1()).dataView);
    const v2 = buildOperatorInput(slow, (await opV2()).dataView);
    expect(v1.payload).not.toHaveProperty("observedCycleTimes");
    expect(userMessage(v1)).not.toContain("observed");
    expect(v2.payload.observedCycleTimes).toContainEqual({ lineId: "SMT-2", partFamily: "A", observedHoursPerUnit: 0.13, observations: 3 });
  });

  test("ages are computed server-side from the snapshot", () => {
    const stale = SCENARIOS.find((s) => s.id === "stale-inventory")!.snapshot;
    const input = buildOperatorInput(stale, { includeMesCycleTimes: true, maxDataAgeShifts: 2 });
    expect(input.provenance.sources).toEqual([
      { source: "erp_routing", ageShifts: 0 },
      { source: "erp_stock", ageShifts: 4 },
      { source: "mes_cycle_times", ageShifts: 0 },
    ]);
  });
});

describe("pricing", () => {
  test("worst-case cost uses the highest input rate and full max_tokens", () => {
    // 1000 input tokens at $8/M (1-hour cache write) + 6000 output at $20/M
    expect(maxCostUsd("claude-opus-5-5", 1000, 6000)).toBeCloseTo(0.008 + 0.12, 10);
  });
  test("actual cost from usage", () => {
    expect(actualCostUsd("claude-opus-5-5", USAGE)).toBeCloseTo(1200 * 4e-6 + 800 * 20e-6, 10);
  });
  test("input-token bound overestimates (2 chars per token)", () => {
    expect(maxInputTokensFor("x".repeat(4000))).toBe(2500);
  });
  test("cap is $18", () => expect(BUDGET_CAP_USD).toBe(18));
  test("unknown model has no pricing → refuses", () => expect(() => maxCostUsd("other", 1, 1)).toThrow(/no pricing/));
});
