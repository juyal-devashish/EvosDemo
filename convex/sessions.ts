import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Step 0 smoke functions so convex-test has something to exercise.
// Role checks (requireRole) arrive with the real schema in step 1.
export const create = mutation({
  args: { label: v.string(), faultInjection: v.boolean() },
  handler: async (ctx, args) => ctx.db.insert("sessions", args),
});

export const get = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => ctx.db.get(sessionId),
});
