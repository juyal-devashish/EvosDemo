import { ConvexError } from "convex/values";

// Plain-language messages for the structured errors Convex functions throw
// (`ConvexError({ code, ... })`). The backend stays the source of truth;
// this only words its answer. Unknown errors fall back to their message.

export type ErrorContext = { operatorVersion?: string };

type ErrorData = { code?: string; [key: string]: unknown };

export function describeError(e: unknown, ctx: ErrorContext = {}): string {
  const who = ctx.operatorVersion ?? "this release";
  if (e instanceof ConvexError) {
    const data = (typeof e.data === "object" && e.data !== null ? e.data : {}) as ErrorData;
    switch (data.code) {
      case "suite_not_passed":
        return `Can't authorize: ${who} hasn't passed ${String(data.suiteVersion ?? "the release suite")}.`;
      case "invalid_transition":
        return `Can't authorize: ${who} is ${String(data.from)}, not shadow.`;
      case "unauthenticated":
        return "Sign in first.";
      case "forbidden":
        return `Your role can't do this. It needs: ${Array.isArray(data.required) ? data.required.join(" or ") : "another role"}.`;
      case "guardrail_failed":
        return "Can't approve: this revision fails a guardrail. Correct it instead.";
      case "not_latest_revision":
        return "This revision has been replaced by a newer one. Review the latest revision.";
      case "fault_injection_not_allowed":
        return "Fault injection is only allowed in sessions flagged for it.";
      case "config":
        return `Server not configured: ${String(data.message ?? "missing setting")}.`;
      case "not_found":
        return "That record no longer exists.";
      default:
        if (typeof data.message === "string") return data.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}
