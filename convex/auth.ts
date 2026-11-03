import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Role } from "./lib/validators";

export type Actor =
  | { kind: "user"; id: string; role: Role }
  | { kind: "system"; id: string };

/**
 * Server-side role check for every mutating public function. Hiding a
 * button is not access control.
 *
 * The role comes from the `role` claim in the caller's JWT (a Clerk JWT
 * template maps it from user public metadata). Callers without an identity
 * or without one of `allowed` are rejected.
 */
export async function requireRole(ctx: QueryCtx, allowed: readonly Role[]): Promise<Actor> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({ code: "unauthenticated" });
  }
  const claimed = identity.role;
  const role = allowed.find((r) => r === claimed);
  if (role === undefined) {
    throw new ConvexError({ code: "forbidden", required: [...allowed] });
  }
  return { kind: "user", id: identity.subject, role };
}

/** Actor for internal callers (Inngest jobs, the monitor, seeding). */
export function systemActor(id: string): Actor {
  return { kind: "system", id };
}
