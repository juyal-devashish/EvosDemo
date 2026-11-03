import { query } from "./_generated/server";
import { SCENARIOS, SUITE_VERSION } from "../sim/scenarios";

// Public, read-only data for the results page (SPEC §12): no login, no
// mutating functions. Every number the page shows comes from these
// structured fields (T2), never from model prose.

const EXAMPLES_PER_FAILURE = 1;

export const publicOverview = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query("suiteRuns").order("desc").collect();
    // Latest finished run per manifest.
    const latest = new Map<string, (typeof runs)[number]>();
    for (const r of runs) {
      if (r.verdict === undefined) continue;
      if (!latest.has(r.manifestHash)) latest.set(r.manifestHash, r);
    }

    const manifests = [];
    for (const run of latest.values()) {
      const manifest = await ctx.db
        .query("manifests")
        .withIndex("by_hash", (q) => q.eq("manifestHash", run.manifestHash))
        .unique();
      if (manifest === null) continue;

      const failedTrials = await ctx.db
        .query("trials")
        .withIndex("by_run", (q) => q.eq("suiteRunId", run._id).eq("state", "failed"))
        .collect();
      const examples = run.verdict!.failures.map((g) => {
        const trials = failedTrials
          .filter((t) => t.scenarioId === g.scenarioId && (t.failures ?? []).some((f) => f.id === g.checkId))
          .sort((a, b) => a.index - b.index)
          .slice(0, EXAMPLES_PER_FAILURE);
        return {
          checkId: g.checkId,
          scenarioId: g.scenarioId,
          trials: trials.map((t) => ({
            trialKey: t.trialKey,
            index: t.index,
            failures: (t.failures ?? []).filter((f) => f.id === g.checkId),
          })),
        };
      });

      manifests.push({
        suiteRunId: run._id,
        operatorVersion: manifest.operatorVersion,
        manifestHash: manifest.manifestHash,
        model: manifest.model,
        effort: manifest.effort,
        maxTokens: manifest.maxTokens,
        dataView: manifest.dataView,
        promptHash: manifest.promptHash,
        guardrailVersion: manifest.guardrailVersion,
        policyVersion: manifest.policyVersion,
        suiteVersion: run.suiteVersion,
        trialsPerScenario: run.trialsPerScenario,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        verdict: run.verdict!,
        examples,
      });
    }
    manifests.sort((a, b) => a.operatorVersion.localeCompare(b.operatorVersion));

    const budget = await ctx.db.query("budget").withIndex("by_key", (q) => q.eq("key", "global")).unique();

    return {
      suiteVersion: SUITE_VERSION,
      scenarios: SCENARIOS.map((s) => ({
        id: s.id,
        family: s.family,
        description: s.description,
        expectedOutcome: s.expectedOutcome.kind,
      })),
      manifests,
      spentUsd: budget?.spentUsd ?? 0,
      capUsd: budget?.capUsd ?? null,
    };
  },
});
