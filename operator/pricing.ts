// Pricing constants for budget reservation (SPEC §11), USD per million tokens.
// Source: Anthropic first-party pricing for claude-opus-5-5 as listed in the
// Claude API reference cached 2026-10-06 (input $4, output $20, cache read
// $0.20; cache writes 1.25× input for 5-minute TTL, 2× for 1-hour).
// Re-check https://platform.claude.com/docs/en/about-claude/pricing before relying on them.

export const PRICING_SOURCE_DATE = "2026-10-06";

export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
  cacheReadPerMTok: number;
};

export const PRICING: Record<string, ModelPricing> = {
  "claude-opus-5-5": {
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheWrite5mPerMTok: 5,
    cacheWrite1hPerMTok: 8,
    cacheReadPerMTok: 0.2,
  },
};

/** Hard ceiling on total API spend for the project. */
export const BUDGET_CAP_USD = 18;

export function pricingFor(model: string): ModelPricing {
  const p = PRICING[model];
  if (p === undefined) throw new Error(`no pricing constants for ${model}; add them before using it`);
  return p;
}

/**
 * Conservative upper bound on input tokens: 1 token per 2 characters plus a
 * fixed allowance. Real tokenizers average ~4 characters per token for
 * English and JSON, so this overestimates by design.
 */
export function maxInputTokensFor(text: string): number {
  return Math.ceil(text.length / 2) + 500;
}

/** Worst case: every input token billed at the higher of input and cache-write rates, plus max_tokens of output. */
export function maxCostUsd(model: string, maxInputTokens: number, maxTokens: number): number {
  const p = pricingFor(model);
  const inputRate = Math.max(p.inputPerMTok, p.cacheWrite5mPerMTok, p.cacheWrite1hPerMTok);
  return (maxInputTokens * inputRate + maxTokens * p.outputPerMTok) / 1_000_000;
}

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
};

/** Actual cost from the response's usage. Cache writes are billed at the 5-minute rate (we don't request 1-hour caching). */
export function actualCostUsd(model: string, u: Usage): number {
  const p = pricingFor(model);
  return (
    (u.input_tokens * p.inputPerMTok +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite5mPerMTok +
      (u.cache_read_input_tokens ?? 0) * p.cacheReadPerMTok +
      u.output_tokens * p.outputPerMTok) /
    1_000_000
  );
}
