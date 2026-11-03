import { internalQuery } from "./_generated/server";

// Exports the recorded rs-1.0 proposals as resampling pools for the monitor
// simulation (SPEC §10.1). Resampled replays are NOT independent AI
// evaluations; the report states how many unique proposals each pool has.
//   npx convex run pools:export > stats/pools.json

export const exportPools = internalQuery({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("suiteRuns").order("desc").collect();
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) if (r.verdict && r.state === "complete" && !latest.has(r.manifestHash)) latest.set(r.manifestHash, r);
    const proposals = [];
    for (const run of latest.values()) {
      const manifest = await ctx.db
        .query("manifests")
        .withIndex("by_hash", (q) => q.eq("manifestHash", run.manifestHash))
        .unique();
      const trials = await ctx.db
        .query("trials")
        .withIndex("by_run", (q) => q.eq("suiteRunId", run._id))
        .collect();
      for (const t of trials) {
        if (!t.revisionId) continue;
        const rev = await ctx.db.get(t.revisionId);
        if (!rev) continue;
        proposals.push({
          operatorVersion: manifest!.operatorVersion,
          manifestHash: run.manifestHash,
          dataView: manifest!.dataView,
          scenarioId: t.scenarioId,
          trialKey: t.trialKey,
          plan: { schedule: rev.schedule, dispositions: rev.dispositions, escalations: rev.escalations, summary: rev.summary },
        });
      }
    }
    proposals.sort((a, b) => a.trialKey.localeCompare(b.trialKey));
    return { exportedFrom: "rs-1.0 suite runs", proposals };
  },
});
