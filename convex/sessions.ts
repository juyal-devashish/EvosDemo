import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { writeAudit } from "./lib/records";
import { scheduleEntry } from "./lib/validators";

const sessionKind = v.union(
  v.literal("suite"),
  v.literal("replay"),
  v.literal("demo"),
  v.literal("test"),
);

async function insertSession(
  ctx: MutationCtx,
  actor: Actor,
  args: { label: string; kind: "suite" | "replay" | "demo" | "test"; faultInjection: boolean; injectWriteFailure?: boolean },
) {
  if (args.kind === "demo" && args.faultInjection) {
    // The public demo session never allows the fault-injection override (§9.4).
    throw new ConvexError({ code: "invalid", message: "demo sessions can't use fault injection" });
  }
  const sessionId = await ctx.db.insert("sessions", {
    label: args.label,
    kind: args.kind,
    faultInjection: args.faultInjection,
    injectWriteFailure: args.injectWriteFailure ?? false,
    currentShift: 0,
    stateVersion: 0,
  });
  await writeAudit(ctx, { sessionId, kind: "session.created", actor, refs: [sessionId] });
  return sessionId;
}

export const create = mutation({
  args: { label: v.string(), kind: sessionKind, faultInjection: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    return insertSession(ctx, actor, args);
  },
});

/** Deterministic fixture seeding (tests, suite trials). No AI. */
export const seed = internalMutation({
  args: {
    label: v.string(),
    kind: sessionKind,
    faultInjection: v.boolean(),
    injectWriteFailure: v.optional(v.boolean()),
    jobs: v.array(v.object({ ...scheduleEntry.fields, frozen: v.boolean() })),
  },
  handler: async (ctx, { jobs, ...args }) => {
    const sessionId = await insertSession(ctx, systemActor("seed"), args);
    for (const job of jobs) await ctx.db.insert("jobs", { sessionId, ...job });
    return sessionId;
  },
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => ctx.db.get(sessionId),
});
