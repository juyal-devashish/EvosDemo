import { v } from "convex/values";
import { BUDGET_CAP_USD, actualCostUsd, type Usage } from "../operator/pricing";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

// Budget reservation (SPEC §11). Before dispatch, a mutation atomically
// reserves the call's worst-case cost; if spent + reserved + max would
// exceed the cap, the call is refused (budget_blocked). After the response,
// the reservation is reconciled with actual usage. A lost or unresolved
// response keeps its full reservation as spent. Retries reserve again.
// Convex serializes mutations on the ledger row, so concurrent reservations
// can't overshoot the cap.

async function ledger(ctx: MutationCtx) {
  const row = await ctx.db.query("budget").withIndex("by_key", (q) => q.eq("key", "global")).unique();
  if (row !== null) return row;
  const id = await ctx.db.insert("budget", { key: "global", capUsd: BUDGET_CAP_USD, spentUsd: 0, reservedUsd: 0 });
  return (await ctx.db.get(id))!;
}

export async function reserve(
  ctx: MutationCtx,
  args: { sessionId: Id<"sessions">; attemptId: Id<"attempts">; model: string; maxCostUsd: number },
): Promise<{ ok: true; reservationId: Id<"budgetReservations"> } | { ok: false; spentUsd: number; reservedUsd: number; capUsd: number }> {
  const row = await ledger(ctx);
  if (row.spentUsd + row.reservedUsd + args.maxCostUsd > row.capUsd) {
    return { ok: false, spentUsd: row.spentUsd, reservedUsd: row.reservedUsd, capUsd: row.capUsd };
  }
  await ctx.db.patch(row._id, { reservedUsd: row.reservedUsd + args.maxCostUsd });
  const reservationId = await ctx.db.insert("budgetReservations", { ...args, state: "open", createdAt: Date.now() });
  return { ok: true, reservationId };
}

/** Settle a reservation: actual cost from usage, or the full reservation when there's no usage (lost). */
export async function settle(ctx: MutationCtx, reservationId: Id<"budgetReservations">, usage: Usage | null) {
  const res = await ctx.db.get(reservationId);
  if (res === null || res.state !== "open") return res?.actualCostUsd ?? null;
  const row = await ledger(ctx);
  const cost = usage === null ? res.maxCostUsd : actualCostUsd(res.model, usage);
  const reserved = row.reservedUsd - res.maxCostUsd;
  await ctx.db.patch(row._id, {
    // Clamp float residue (e.g. 2e-16) so an idle ledger reads exactly 0.
    reservedUsd: reserved < 1e-9 ? 0 : reserved,
    spentUsd: row.spentUsd + cost,
  });
  await ctx.db.patch(reservationId, {
    state: usage === null ? "lost" : "reconciled",
    actualCostUsd: cost,
    resolvedAt: Date.now(),
  });
  return cost;
}

export async function readLedger(ctx: QueryCtx) {
  const row = await ctx.db.query("budget").withIndex("by_key", (q) => q.eq("key", "global")).unique();
  return row === null
    ? { capUsd: BUDGET_CAP_USD, spentUsd: 0, reservedUsd: 0 }
    : { capUsd: row.capUsd, spentUsd: row.spentUsd, reservedUsd: row.reservedUsd };
}

export const status = internalQuery({ args: {}, handler: (ctx) => readLedger(ctx) });

export const reservations = internalQuery({
  args: { state: v.optional(v.union(v.literal("open"), v.literal("reconciled"), v.literal("lost"))) },
  handler: (ctx, { state }) =>
    state === undefined
      ? ctx.db.query("budgetReservations").collect()
      : ctx.db.query("budgetReservations").withIndex("by_state", (q) => q.eq("state", state)).collect(),
});
