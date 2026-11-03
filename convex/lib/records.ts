import { ConvexError } from "convex/values";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../auth";
import type { PermissionLevel, Scope } from "./validators";

type SessionScoped = {
  [T in TableNames]: Doc<T> extends { sessionId: Id<"sessions"> } ? T : never;
}[TableNames];

/**
 * Load a session-scoped record and check it belongs to `sessionId`.
 * Records from another session are treated as missing (isolation, §9.1).
 */
export async function getInSession<T extends SessionScoped>(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  id: Id<T>,
): Promise<Doc<T>> {
  const doc = (await ctx.db.get(id)) as (Doc<T> & { sessionId: Id<"sessions"> }) | null;
  if (doc === null || doc.sessionId !== sessionId) {
    throw new ConvexError({ code: "not_found", id });
  }
  return doc;
}

export async function getSession(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  if (session === null) throw new ConvexError({ code: "not_found", id: sessionId });
  return session;
}

export async function writeAudit(
  ctx: MutationCtx,
  entry: {
    sessionId: Id<"sessions">;
    kind: string;
    actor: Actor;
    refs: string[];
    detail?: string;
  },
) {
  return ctx.db.insert("audit", { ...entry, at: Date.now() });
}

/** Current permission level; no row means the default, shadow (§9.4). */
export async function currentPermission(
  ctx: QueryCtx,
  key: { sessionId: Id<"sessions">; manifestHash: string; scope: Scope },
): Promise<{ level: PermissionLevel; row: Doc<"permissions"> | null }> {
  const row = await ctx.db
    .query("permissions")
    .withIndex("by_key", (q) =>
      q.eq("sessionId", key.sessionId).eq("manifestHash", key.manifestHash).eq("scope", key.scope),
    )
    .unique();
  return { level: row?.level ?? "shadow", row };
}

/** `demoted` grants exactly what `supervised` grants. */
export function effectiveLevel(level: PermissionLevel): "shadow" | "supervised" | "limited" {
  return level === "demoted" ? "supervised" : level;
}
