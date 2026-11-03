// Structured operational events (SPEC §2: permission.demoted, action.refused,
// suite.incomplete). Logged as one JSON line, which shows in the Convex
// dashboard logs. Forwarding to Sentry comes with the Sentry setup in
// step 5 (plan.md); until then this is the only sink.

export type TelemetryEvent = "suite.incomplete" | "permission.demoted" | "action.refused";

export function logEvent(event: TelemetryEvent, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data }));
}
