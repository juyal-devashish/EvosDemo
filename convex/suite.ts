import { ConvexError, v } from "convex/values";
import { evaluatePlan } from "../checks/evaluate";
import { computeVerdict, type TrialOutcome } from "../checks/verdict";
import { SCENARIOS, SUITE_VERSION, seedScenario } from "../sim/scenarios";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { requireRole, systemActor, type Actor } from "./auth";
import { executeActionInTransaction } from "./execute";
import { loadJobs } from "./lib/factory";
import { getSession, writeAudit } from "./lib/records";
import { reportEvent } from "./lib/telemetry";
import type { ProposeResult } from "./operator";
import { setLevel } from "./permissions";
import { enqueue } from "./queue";
import { insertScenarioSession, insertSession } from "./sessions";

// Release suite runs (SPEC §8). Fan-out uses the Convex scheduler (a
// deliberate deviation from SPEC §2's Inngest; see plan.md, step 4). Each
// trial runs in its own seeded session, is judged on its FIRST attempt,
// and records infrastructure retries without letting them replace it.

export const DEFAULT_TRIALS_PER_SCENARIO = 10;
/** Spacing between scheduled trials, to stay well inside API rate limits. */
const STAGGER_MS = 1500;
/** Infrastructure retries after a first attempt that got no response. Recorded, never scored. */
const INFRA_RETRIES = 1;

async function startRun(
  ctx: MutationCtx,
  actor: Actor,
  args: { manifestHash: string; trialsPerScenario: number; scenarioIds: string[] },
) {
  const manifest = await ctx.db
    .query("manifests")
    .withIndex("by_hash", (q) => q.eq("manifestHash", args.manifestHash))
    .unique();
  if (manifest === null) throw new ConvexError({ code: "not_found", manifestHash: args.manifestHash });
  if (manifest.suiteVersion !== SUITE_VERSION) {
    throw new ConvexError({ code: "suite_mismatch", manifest: manifest.suiteVersion, suite: SUITE_VERSION });
  }
  for (const id of args.scenarioIds) {
    if (!SCENARIOS.some((s) => s.id === id)) throw new ConvexError({ code: "not_found", scenarioId: id });
  }
  const sessionId = await insertSession(ctx, actor, {
    label: `${SUITE_VERSION} run of ${manifest.operatorVersion}`,
    kind: "suite",
    faultInjection: false,
  });
  const suiteRunId = await ctx.db.insert("suiteRuns", {
    sessionId,
    manifestHash: args.manifestHash,
    suiteVersion: SUITE_VERSION,
    scenarioIds: args.scenarioIds,
    trialsPerScenario: args.trialsPerScenario,
    state: "running",
    startedBy: actor,
    startedAt: Date.now(),
  });
  let n = 0;
  for (const scenarioId of args.scenarioIds) {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
    for (let index = 0; index < args.trialsPerScenario; index++) {
      const trialKey = `${SUITE_VERSION}:${args.manifestHash.slice(0, 12)}:${suiteRunId}:${scenarioId}:${index}`;
      const trialSession = await insertScenarioSession(ctx, scenarioId, trialKey);
      const trialId = await ctx.db.insert("trials", {
        suiteRunId,
        trialKey,
        scenarioId,
        index,
        expectedOutcome: scenario.expectedOutcome.kind,
        sessionId: trialSession,
        state: "pending",
      });
      await ctx.scheduler.runAfter(n * STAGGER_MS, internal.suite.runTrial, { trialId });
      n++;
    }
  }
  await writeAudit(ctx, {
    sessionId,
    kind: "suite.started",
    actor,
    refs: [suiteRunId],
    detail: `${n} trials of ${manifest.operatorVersion}`,
  });
  return suiteRunId;
}

/** qa starts a release-suite run. Each trial makes a real model call. */
export const start = mutation({
  args: { manifestHash: v.string(), trialsPerScenario: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["qa"]);
    return startRun(ctx, actor, {
      manifestHash: args.manifestHash,
      trialsPerScenario: args.trialsPerScenario ?? DEFAULT_TRIALS_PER_SCENARIO,
      scenarioIds: SCENARIOS.map((s) => s.id),
    });
  },
});

/**
 * CLI entry point (npx convex run), for runs before the UI exists. REAL API
 * CALLS: one per trial. Ask before running.
 */
export const startFromCli = internalMutation({
  args: { manifestHash: v.string(), trialsPerScenario: v.optional(v.number()), scenarioIds: v.optional(v.array(v.string())) },
  handler: (ctx, args) =>
    startRun(ctx, systemActor("cli"), {
      manifestHash: args.manifestHash,
      trialsPerScenario: args.trialsPerScenario ?? DEFAULT_TRIALS_PER_SCENARIO,
      scenarioIds: args.scenarioIds ?? SCENARIOS.map((s) => s.id),
    }),
});

export const trialContext = internalQuery({
  args: { trialId: v.id("trials") },
  handler: async (ctx, { trialId }) => {
    const trial = await ctx.db.get(trialId);
    if (trial === null) throw new ConvexError({ code: "not_found", trialId });
    const run = (await ctx.db.get(trial.suiteRunId))!;
    const manifest = await ctx.db
      .query("manifests")
      .withIndex("by_hash", (q) => q.eq("manifestHash", run.manifestHash))
      .unique();
    return { trial, run, manifest: manifest! };
  },
});

export const revision = internalQuery({
  args: { revisionId: v.id("proposalRevisions") },
  handler: (ctx, { revisionId }) => ctx.db.get(revisionId),
});

/** Run one trial: first attempt, optional infra retry, then score the first attempt. */
export const runTrial = internalAction({
  args: { trialId: v.id("trials") },
  handler: async (ctx, { trialId }): Promise<void> => {
    const { trial, run, manifest } = await ctx.runQuery(internal.suite.trialContext, { trialId });
    if (trial.state !== "pending") return; // already recorded (idempotent)
    if (run.state === "cancelled") {
      await ctx.runMutation(internal.suite.recordTrial, { trialId, state: "missing", missingReason: "cancelled" });
      return;
    }

    const propose = (n: number): Promise<ProposeResult> =>
      ctx.runAction(internal.operator.propose, {
        sessionId: trial.sessionId,
        manifestHash: run.manifestHash,
        trigger: `suite:${trial.trialKey}`,
        trialId,
        n,
      });

    const first = await propose(1);
    // Retries are recorded and shown; they never replace the first result.
    let last = first;
    for (let n = 2; n <= 1 + INFRA_RETRIES && (last.status === "api_error" || last.status === "timeout"); n++) {
      last = await propose(n);
    }

    if (first.status === "api_error" || first.status === "timeout" || first.status === "budget_blocked") {
      await ctx.runMutation(internal.suite.recordTrial, {
        trialId,
        state: "missing",
        missingReason: first.status === "budget_blocked" ? "budget" : first.status,
        firstAttemptId: first.attemptId,
      });
      return;
    }
    if (first.status === "refusal" || first.status === "parse_fail") {
      await ctx.runMutation(internal.suite.recordTrial, {
        trialId,
        state: "failed",
        failures: [{ id: `ATTEMPT_${first.status.toUpperCase()}`, message: `first attempt: ${first.status}` }],
        firstAttemptId: first.attemptId,
      });
      return;
    }

    const rev = await ctx.runQuery(internal.suite.revision, { revisionId: first.revisionId! });
    const scenario = seedScenario(SCENARIOS.find((s) => s.id === trial.scenarioId)!);
    const verdict = evaluatePlan(scenario, rev!, manifest.dataView);
    const failures: { id: string; message: string; orderId?: string }[] = verdict.failures.map((f) => ({
      id: f.id,
      message: f.message,
      ...("orderId" in f && f.orderId ? { orderId: f.orderId } : {}),
    }));

    if (verdict.passed && scenario.expectedOutcome.kind === "failure_handled") {
      const write = await ctx.runMutation(internal.suite.checkFailedWrite, { trialId, revisionId: first.revisionId! });
      if (!write.ok) failures.push({ id: "FAILED_WRITE", message: write.detail });
    }

    await ctx.runMutation(internal.suite.recordTrial, {
      trialId,
      state: failures.length === 0 ? "passed" : "failed",
      failures,
      firstAttemptId: first.attemptId,
      revisionId: first.revisionId,
    });
  },
});

/**
 * Failed-write scenario: execute the trial's plan through the real
 * execution path and check it reports `failed` with no business-state
 * change. Only in the trial's own isolated suite session, under a
 * recorded `suite_harness` permission.
 */
export const checkFailedWrite = internalMutation({
  args: { trialId: v.id("trials"), revisionId: v.id("proposalRevisions") },
  handler: async (ctx, { trialId, revisionId }) => {
    const trial = (await ctx.db.get(trialId))!;
    const session = await getSession(ctx, trial.sessionId);
    if (session.kind !== "suite" || !session.injectWriteFailure) {
      throw new ConvexError({ code: "invariant", message: "failed-write harness needs a suite session with injected write failure" });
    }
    const revision = (await ctx.db.get(revisionId))!;
    const proposal = (await ctx.db.get(revision.proposalId))!;
    const actor = systemActor("suite_harness");
    const key = { sessionId: session._id, manifestHash: proposal.manifestHash, scope: proposal.scope };
    await setLevel(ctx, key, { to: "supervised", trigger: "suite_harness", actor, evidenceIds: [trialId] });
    const approvalId = await ctx.db.insert("approvals", {
      sessionId: session._id,
      proposalRevisionId: revisionId,
      baseStateVersion: session.stateVersion,
      actor,
      manifestHash: proposal.manifestHash,
      decidedAt: Date.now(),
    });
    const actionId = await enqueue(ctx, { session, proposal, revisionId, queuedUnder: "supervised", approvalId, actor });

    const before = await loadJobs(ctx, session._id);
    const out = await executeActionInTransaction(ctx, { sessionId: session._id, actionId });
    const after = await loadJobs(ctx, session._id);
    const sessionAfter = await getSession(ctx, session._id);

    const sameJobs = JSON.stringify([...before.frozen, ...before.movable].map((j) => j._id).sort()) ===
      JSON.stringify([...after.frozen, ...after.movable].map((j) => j._id).sort());
    if (out.result !== "failed") return { ok: false, detail: `execution result ${out.result}, expected failed` };
    if (!sameJobs || sessionAfter.stateVersion !== session.stateVersion) {
      return { ok: false, detail: "failed write changed business state" };
    }
    return { ok: true, detail: "failed, no business-state change" };
  },
});

const failureValidator = v.object({ id: v.string(), message: v.string(), orderId: v.optional(v.string()) });

async function finalizeIfDone(ctx: MutationCtx, run: Doc<"suiteRuns">) {
  const trials = await ctx.db
    .query("trials")
    .withIndex("by_run", (q) => q.eq("suiteRunId", run._id))
    .collect();
  if (trials.some((t) => t.state === "pending")) return null;
  const outcomes: TrialOutcome[] = trials.map((t) =>
    t.state === "passed"
      ? { scenarioId: t.scenarioId, state: "passed" }
      : t.state === "failed"
        ? { scenarioId: t.scenarioId, state: "failed", failedChecks: (t.failures ?? []).map((f) => f.id) }
        : { scenarioId: t.scenarioId, state: "missing", reason: t.missingReason ?? "unknown" },
  );
  const verdict = computeVerdict({
    suiteVersion: run.suiteVersion,
    manifestHash: run.manifestHash,
    scenarioIds: run.scenarioIds,
    trialsPerScenario: run.trialsPerScenario,
    trials: outcomes,
  });
  // Only a run over the whole suite can pass the release gate.
  const fullSuite = SCENARIOS.every((s) => run.scenarioIds.includes(s.id));
  const gateKind = verdict.kind === "passed" && !fullSuite ? "incomplete" : verdict.kind;
  await ctx.db.patch(run._id, {
    state: run.state === "cancelled" ? "cancelled" : "complete",
    finishedAt: Date.now(),
    verdict,
  });
  await ctx.db.insert("suiteVerdicts", {
    sessionId: run.sessionId,
    manifestHash: run.manifestHash,
    suiteVersion: run.suiteVersion,
    verdict: gateKind,
    scenarioIds: run.scenarioIds,
    recordedAt: Date.now(),
  });
  const actor = systemActor("suite");
  await writeAudit(ctx, { sessionId: run.sessionId, kind: `suite.${verdict.kind}`, actor, refs: [run._id], detail: verdict.text });
  if (verdict.kind === "incomplete") {
    await reportEvent(ctx, "suite.incomplete", { suiteRunId: run._id, manifestHash: run.manifestHash, missing: verdict.missing });
  }
  return verdict;
}

export const recordTrial = internalMutation({
  args: {
    trialId: v.id("trials"),
    state: v.union(v.literal("passed"), v.literal("failed"), v.literal("missing")),
    failures: v.optional(v.array(failureValidator)),
    missingReason: v.optional(v.string()),
    firstAttemptId: v.optional(v.id("attempts")),
    revisionId: v.optional(v.id("proposalRevisions")),
  },
  handler: async (ctx, { trialId, ...result }) => {
    const trial = await ctx.db.get(trialId);
    if (trial === null) throw new ConvexError({ code: "not_found", trialId });
    if (trial.state !== "pending") return null; // first record wins
    await ctx.db.patch(trialId, { ...result, finishedAt: Date.now() });
    const run = (await ctx.db.get(trial.suiteRunId))!;
    return finalizeIfDone(ctx, run);
  },
});

async function cancelRun(ctx: MutationCtx, suiteRunId: Id<"suiteRuns">, actor: Actor) {
  const run = await ctx.db.get(suiteRunId);
  if (run === null) throw new ConvexError({ code: "not_found", suiteRunId });
  if (run.state !== "running") return null;
  await ctx.db.patch(suiteRunId, { state: "cancelled" });
  const pending = await ctx.db
    .query("trials")
    .withIndex("by_run", (q) => q.eq("suiteRunId", suiteRunId).eq("state", "pending"))
    .collect();
  for (const t of pending) await ctx.db.patch(t._id, { state: "missing", missingReason: "cancelled", finishedAt: Date.now() });
  await writeAudit(ctx, { sessionId: run.sessionId, kind: "suite.cancelled", actor, refs: [suiteRunId] });
  return finalizeIfDone(ctx, { ...run, state: "cancelled" });
}

export const cancel = mutation({
  args: { suiteRunId: v.id("suiteRuns") },
  handler: async (ctx, { suiteRunId }) => cancelRun(ctx, suiteRunId, await requireRole(ctx, ["qa"])),
});

export const cancelFromCli = internalMutation({
  args: { suiteRunId: v.id("suiteRuns") },
  handler: (ctx, { suiteRunId }) => cancelRun(ctx, suiteRunId, systemActor("cli")),
});

/** Public read: suite runs and verdicts are shown on the results page without login. */
export const getRun = query({
  args: { suiteRunId: v.id("suiteRuns") },
  handler: async (ctx, { suiteRunId }) => {
    const run = await ctx.db.get(suiteRunId);
    if (run === null) return null;
    const trials = await ctx.db
      .query("trials")
      .withIndex("by_run", (q) => q.eq("suiteRunId", suiteRunId))
      .collect();
    const counts = { pending: 0, passed: 0, failed: 0, missing: 0 };
    for (const t of trials) counts[t.state]++;
    return { run, counts };
  },
});

export const listRuns = query({
  args: {},
  handler: (ctx) => ctx.db.query("suiteRuns").order("desc").take(20),
});
