import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PlanSchema, type PlanFromModel } from "./planSchema";
import { SYSTEM_PROMPT } from "./prompt";
import type { Usage } from "./pricing";
import type { Manifest } from "./manifest";

// One model call for one proposal. Model and settings come only from the
// manifest. No sampling parameters, no SDK retries (each retry is a new,
// separately reserved and recorded attempt), and no refusal fallback to
// another model: the manifest names the model, and a proposal from a
// different model would not be the manifest's proposal.

export type AttemptStatus = "ok" | "api_error" | "timeout" | "refusal" | "parse_fail";

export type CallOutcome =
  | { status: "ok"; plan: PlanFromModel; usage: Usage; stopReason: string }
  | { status: "refusal" | "parse_fail"; usage: Usage; stopReason: string | null; detail: string }
  | { status: "api_error" | "timeout"; usage: null; detail: string };

/** The slice of the SDK client this module needs; tests pass a fake. */
export type MessagesClient = { messages: Pick<Anthropic["messages"], "create"> };

export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const usageOf = (u: Anthropic.Usage): Usage => ({
  input_tokens: u.input_tokens,
  output_tokens: u.output_tokens,
  cache_creation_input_tokens: u.cache_creation_input_tokens ?? null,
  cache_read_input_tokens: u.cache_read_input_tokens ?? null,
});

export function newClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
}

export async function callOperator(client: MessagesClient, manifest: Manifest, userMessage: string): Promise<CallOutcome> {
  let response;
  try {
    response = await client.messages.create({
      model: manifest.model,
      max_tokens: manifest.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: { effort: manifest.effort, format: zodOutputFormat(PlanSchema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return { status: "timeout", usage: null, detail: error.message };
    }
    if (error instanceof Anthropic.APIError) {
      return { status: "api_error", usage: null, detail: `${error.status ?? "connection"}: ${error.message}` };
    }
    return { status: "api_error", usage: null, detail: error instanceof Error ? error.message : String(error) };
  }

  const usage = usageOf(response.usage);
  if (response.stop_reason === "refusal") {
    return { status: "refusal", usage, stopReason: "refusal", detail: response.stop_details?.category ?? "uncategorized" };
  }
  if (response.stop_reason === "max_tokens") {
    return { status: "parse_fail", usage, stopReason: "max_tokens", detail: "hit max_tokens before finishing the plan" };
  }
  // Parse here (not with messages.parse) so a schema mismatch is a recorded
  // parse_fail that keeps the response's usage: those tokens were billed.
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: "parse_fail", usage, stopReason: response.stop_reason, detail: "response is not JSON" };
  }
  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { status: "parse_fail", usage, stopReason: response.stop_reason, detail: `schema mismatch: ${issues}` };
  }
  return { status: "ok", plan: parsed.data, usage, stopReason: response.stop_reason ?? "unknown" };
}
