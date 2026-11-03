import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

// Structured operational events (SPEC §2): permission.demoted,
// action.refused, suite.incomplete. Each is logged as one JSON line (Convex
// dashboard logs) and forwarded to Sentry by convex/telemetry.ts. The
// forward is scheduled, so it only happens if the calling mutation commits.

export type TelemetryEvent = "suite.incomplete" | "permission.demoted" | "action.refused";

const LEVEL: Record<TelemetryEvent, "info" | "warning" | "error"> = {
  "suite.incomplete": "warning",
  "permission.demoted": "warning",
  "action.refused": "info",
};

export async function reportEvent(ctx: MutationCtx, event: TelemetryEvent, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
  await ctx.scheduler.runAfter(0, internal.telemetry.send, { event, level: LEVEL[event], data });
}
