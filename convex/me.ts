import { query } from "./_generated/server";

/** The caller's role as Convex sees it (from the JWT), for showing the right navigation. Not access control. */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;
    const role = identity.role === "qa" || identity.role === "planner" ? identity.role : null;
    return { subject: identity.subject, name: identity.name ?? identity.email ?? null, role };
  },
});
