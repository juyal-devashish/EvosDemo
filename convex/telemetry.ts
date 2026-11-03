import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// Forwards operational events to Sentry (SPEC §2). Scheduled from the
// mutation that caused the event, so it only sends if that mutation
// committed. Convex has no Sentry SDK runtime, so this posts one event in
// Sentry's envelope format to the project's ingest endpoint from SENTRY_DSN.
// Without SENTRY_DSN it does nothing; the event is still in the logs.

function parseDsn(dsn: string) {
  const u = new URL(dsn);
  const projectId = u.pathname.replace(/^\//, "");
  return { key: u.username, host: u.host, protocol: u.protocol, projectId };
}

export const send = internalAction({
  args: { event: v.string(), level: v.union(v.literal("info"), v.literal("warning"), v.literal("error")), data: v.any() },
  handler: async (_ctx, { event, level, data }) => {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) return { sent: false as const, reason: "SENTRY_DSN not set" };
    const { key, host, protocol, projectId } = parseDsn(dsn);
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const now = new Date().toISOString();
    const payload = {
      event_id: eventId,
      timestamp: now,
      platform: "javascript",
      level,
      logger: "convex",
      message: { formatted: event },
      tags: { event, runtime: "convex" },
      extra: data,
    };
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: now, dsn }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(payload),
    ].join("\n");
    const res = await fetch(`${protocol}//${host}/api/${projectId}/envelope/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=earned-autonomy-convex/1.0`,
      },
      body: envelope,
    });
    return { sent: res.ok, status: res.status };
  },
});
