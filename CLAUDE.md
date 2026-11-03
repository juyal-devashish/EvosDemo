# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Current state

Steps 0–7 are done: Next.js 16 App Router, Convex (anonymous local deployment), Vitest + `convex-test`, Playwright (empty suite), the full Convex schema, the permission levels, approvals, the action queue and the atomic `executeAction` in [convex/execute.ts](convex/execute.ts), the scheduling model and oracle in [sim/](sim/), the 8 rs-1.0 scenarios in [sim/scenarios.ts](sim/scenarios.ts), and every check in [checks/](checks/) (G1–G8, C1–C4, T1/T3/T4, plus `evaluatePlan`). The operator (prompt, Zod plan schema, manifests op-v1/op-v2, data view, pricing, model call) is in [operator/](operator/); budget and attempts are in [convex/budget.ts](convex/budget.ts) and [convex/operator.ts](convex/operator.ts). The model is `claude-opus-5-5`, effort low. The prompt hash covers the system prompt *and* the output schema, whose field order is deliberate (see [operator/planSchema.ts](operator/planSchema.ts)). Real API calls go only through `operator:propose`, and tests use a fake client. Release-suite runs are in [convex/suite.ts](convex/suite.ts) (Convex scheduler fan-out, first-attempt verdicts from [checks/verdict.ts](checks/verdict.ts)). Current results: op-v2 `c506…` passed rs-1.0; op-v1 `fa05…` failed. Step-specific deviations and deferrals are recorded under each step in plan.md. Backend test fixtures live in [tests/backend/fixtures.ts](tests/backend/fixtures.ts). Shared domain types live in [sim/domain.ts](sim/domain.ts); extend them, don't redefine them. The commands in AGENTS.md are the real scripts.

`npm run convex` (the Convex watcher) only redeploys when files under `convex/` change. After editing `operator/`, `checks/` or `sim/`, touch a file in `convex/` (or restart the watcher) before making real calls. Otherwise the deployed code is stale: this once registered the old low-effort manifests.

Next.js 16 differs from older versions (for example, the global `LayoutProps` route types come from `next typegen`). Check `node_modules/next/dist/docs/` before writing Next code.

[plan.md](plan.md) is the step-by-step build plan: done criteria, which tests each step needs, and where to stop and ask before making API calls or deploying. Follow it, and keep it updated as steps finish.

## Architecture (big picture from SPEC.md)

These ideas span several modules. Read the cited section before touching any of them.

- **Two acts, kept apart.** Act 1 is a release gate with real AI runs: `op-v1` fails `rs-1.0` on the slow-machine scenario and `op-v2` passes. Act 2 is a labeled fault-injection replay in which `op-v1` is forced into limited autonomy, gets demoted, and its queued action is refused at the next shift boundary (§0). That refusal is the headline moment.
- **Manifest-bound permissions.** A manifest is a hashed bundle: prompt, model, effort, data view, and guardrail, policy and suite versions (§6). Permissions are keyed by `sessionId × manifestHash × scope`. The levels are shadow → supervised → limited → demoted (§9.4). A new manifest never inherits a permission. `op-v1` and `op-v2` differ only in `dataView.includeMesCycleTimes`.
- **Three layers of checks** (§7), as pure functions in `checks/`:
  - **G1–G8 guardrails** run at proposal time and again inside the execution transaction. Approval can't override them.
  - **C1–C4 suite checks** need scenario ground truth from `sim/oracle.ts`, an exhaustive search over ≤ 6 orders. The oracle and the checks are separate code paths.
  - **T1–T4 truth checks** confirm that the screen, stored data and executed diff agree.
- **Drift is caught deliberately by the suite and monitor, not a guardrail.** G7 measures duration against the ERP standard (the source of record). Simulated reality uses the drifted machine, so C4 catches drift in testing and the monitor catches it in production (§3).
- **Execution path.** `convex/execute.ts` → `executeAction` is one transaction: read permission → validate approval or limited permission → dedup on `executions[actionId]` → re-run G1–G8 → write the diff or record the refusal (§9.5). The Inngest `shiftBoundary` function runs its steps in order: close the monitoring period → commit any demotion → release the queue (§9.6). That ordering is what makes the headline refusal happen.
- **Approvals bind to immutable revisions.** An edit creates a new revision and voids earlier approvals. A changed `stateVersion` forces guardrails to re-run, and a failure there is recorded as `stale_approval` (§9.3).
- **Suite verdicts use first attempts only.** Retries are recorded but never replace a failed first result. Missing or budget-blocked trials make the suite `incomplete` (§8).
- **Monitoring has two separate experiments** (§10.1):
  - The **monitor simulation** resamples proposal pools to measure false-alarm and detection rates.
  - The **recorded session** has real proposals and is the only source of the headline story.

  The demotion rule is a binomial tail test with α = 0.00135 over 3-day windows, and n < 15 is reported as insufficient data (§10.4). Recovery requires ≥ 80 fresh reviews with a Clopper–Pearson lower bound ≥ 0.90 (§10.6).
- **Isolation.** Every state table carries `sessionId`. Suite runs, the fault-injection replay and the public demo each get their own session (§9.1).

The planned module layout is in SPEC §16, and the open decisions (model choice, trial counts, reviewer rates) are in SPEC §18.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
