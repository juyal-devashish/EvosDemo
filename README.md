<div align="center">

# Earned Autonomy

**An AI operator earns autonomy step by step, and loses it automatically when the evidence turns.**

A release gate, a permission ladder and a production monitor for one AI scheduling operator in a simulated PCB factory.

[**Live demo →**](https://earned-autonomy.vercel.app) &nbsp;·&nbsp; [How it works](#how-it-works) &nbsp;·&nbsp; [Results](#the-two-acts) &nbsp;·&nbsp; [Run it](#run-it)

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![Convex](https://img.shields.io/badge/backend-Convex-EE342F)
![AI: Claude](https://img.shields.io/badge/AI-Claude%20%28Anthropic%29-8A63D2)
![Tests: 158](https://img.shields.io/badge/tests-158%20passing-2EA44F)
![Simulated factory](https://img.shields.io/badge/data-simulated%20factory-critical)

</div>

![Release suite results: op-v1 fails rs-1.0, op-v2 passes](docs/img/release-gate.png)

## How it works, in one page

- **The problem:** AI agents are going onto factory floors. A team either trusts an agent completely or ignores it, and nothing lets trust grow with evidence or shrink when the factory changes under the agent.
- **What this does:** every release of the operator must pass a fixed test suite before it gets any autonomy. In production it climbs a ladder, **shadow → supervised → limited**, and a statistical monitor of human reviews demotes it the moment its decisions drift out of agreement with the team.
- **Who does what:** Claude proposes schedules. Deterministic code checks every proposal and enforces the permission level in one atomic transaction. People review, approve and restore autonomy.

> [!WARNING]
> **Independent project on a simulated factory.** The factory, machines, orders and the reviewer are synthetic. Every operator proposal is a real Claude API call. Results come from recorded runs, not from a real production line, and this is not any real product's implementation.

---

## Why

At Micron I worked on real-time sensor anomaly detection in a wafer fab, and two things stuck with me.

- **Equipment drifts.** A tool's temperature creeps, so what counted as normal last quarter isn't normal now, and a model that was right then can be quietly wrong today.
- **Trust is all or nothing.** People on the floor either trusted automation completely or ignored it.

AI agents inherit both problems. This project asks what happens when the factory changes under an agent and how the system should take that agent's autonomy away before it does damage. At Michigan I studied how to detect a change in a data stream quickly without false alarms; the monitor here asks the same question with a windowed binomial test (a sequential test such as CUSUM is the natural next step).

The factory is a simulated electronics (PCB) assembly line, deliberately simpler than a fab.

## How it works

```mermaid
flowchart LR
    subgraph Release["Release gate"]
        direction TB
        M[Operator release<br/>prompt + data view + model] --> S[Suite rs-1.0<br/>8 scenarios × 10 trials]
        S --> V{All checks<br/>pass?}
    end
    subgraph Prod["Production"]
        direction TB
        SH[Shadow<br/>never executes] --> SU[Supervised<br/>a planner approves each plan]
        SU --> LI[Limited<br/>executes within guardrails]
    end
    subgraph Guard["Every execution"]
        direction TB
        EX[One atomic transaction:<br/>dedup, re-check permission<br/>and guardrails G1–G8] --> OUT[Write the approved diff<br/>or record a refusal]
    end
    V -- passed --> SH
    V -- failed --> X[Blocked]
    LI --> EX
    SU --> EX
    REV[Human reviews] --> MON[Monitor<br/>3-day binomial test]
    MON -- agreement drops --> DEM[Demote at the<br/>shift boundary]
    DEM --> SU
```

1. **Release gate.** A release is a manifest: prompt, data view, model and settings, hashed. It runs the same suite, `rs-1.0`, of 8 factory scenarios × 10 trials. Checks C1–C4 and truth checks are pure functions compared with an exhaustive oracle. Missing, incomplete or budget-blocked trials never count as passes.
2. **Permission ladder.** A release that passes starts in shadow mode (it proposes, nothing executes), moves to supervised (a planner approves every plan) and can be authorized to limited autonomy by a `qa` user.
3. **Execution.** Each action runs as one Convex mutation that deduplicates, re-checks the permission and the hard guardrails, then writes exactly the approved diff or records a refusal. Refusals are recorded, never thrown, so the refusal log can't roll back.
4. **Monitoring.** Human reviews of the operator's plans are tested in 3-day windows against a frozen baseline. When agreement falls, the monitor signals; at the next shift boundary the period closes, any demotion is committed, and only then is the action queue released. That ordering is why a demoted operator's queued action is refused.

## The two acts

**1. Release gate (real AI runs).** Each operator release runs `rs-1.0`.

| Release | Verdict |
|---|---|
| `op-v1`: its data view lacks observed machine cycle times | **Failed:** C4 on slow-machine, 10/10 trials; T1 on conflicting-priorities, 8/10 |
| `op-v2`: the fix, which includes observed cycle times | **Passed** rs-1.0, 80/80 |

**2. Fault-injection replay (labeled as such).** What if a defect like op-v1's slipped past the gate? In an isolated session, op-v1 is deliberately given limited autonomy, and from day 4 the SMT-2 machine runs 30% slow.

- The synthetic reviewer's agreement falls from 17/17 to 0/17.
- The monitor's binomial test signals and demotes op-v1.
- At the next shift boundary, the backend **refuses its queued action**, and the [evidence viewer](https://earned-autonomy.vercel.app) shows the whole chain behind that refusal.
- **Recovery:** op-v2 earned 78/80 fresh supervised reviews (95% lower bound 0.923, above the 0.90 floor), and `qa` authorized it back to limited autonomy.

![Fault-injection replay: review agreement falls on day 4, the monitor alarms, op-v1 is demoted and op-v2 recovers](docs/img/demotion-refusal.png)

The evidence viewer traces the refusal back to the reviews behind it:

![Evidence for the refused action: refusal, permission change, monitor check, reviews, and the fix](docs/img/evidence.png)

## Monitor validation

The monitor was validated separately, on 1,000 seeded replays per condition of the recorded proposals (30-day horizon, drift from day 10). Its configuration was [frozen](stats/config.ts) before the recorded session ran.

| Condition | Result (95% CI) | Detection delay |
|---|---|---|
| Healthy | P(≥1 false demotion in 30 days) = 0.2% (0.02–0.7%) | – |
| Drift affects 25% of routine proposals | detected 97.6% (96.4–98.5%) | median 6 days, p90 13 |
| Drift 50% | detected 100% (99.6–100%) | median 4, p90 4 |
| Drift 100% | detected 100% (99.6–100%) | median 4, p90 4 |

These describe the monitor's statistical behavior on resampled pools with only 40 and 10 unique proposals, not AI behavior on new states. `npm run validate:monitor` reproduces them; the full report is in [stats/validation-report.json](stats/validation-report.json).

## Features

**Release and checks**
- Hashed manifests: a release is the exact prompt, data view, model and settings it ran with.
- Suite checks C1–C4, truth checks against an exhaustive scheduling oracle, and per-trial verdicts, all pure functions with a passing and a failing fixture each.
- Hard guardrails G1–G8 that no approval can override.

**Production**
- The shadow → supervised → limited ladder, per session, release and scope, with role checks (`planner`, `qa`) enforced server-side.
- Atomic execution with deduplication, re-checks and recorded refusals.
- A shift boundary that closes the period, commits demotions, then releases the queue.
- An evidence viewer that links a refusal to the permission change, the monitor check, the reviews and the fix.

**Statistics**
- Exact binomial tail test in 3-day windows (α = 0.00135), with insufficient-data and pending-review handling.
- One-sided Clopper–Pearson bounds for the recovery criterion, and an EWMA shown as context only.

**Cost and safety**
- Every model call reserves budget first, under a hard $18 cap with concurrent dispatches. About $7 has been spent in total.
- Refusals, timeouts, parse failures and budget blocks are recorded as failed attempts, never dropped.

## What's real and what's simulated

| Real | Simulated |
|---|---|
| Every operator proposal (a Claude API call) | The PCB factory, machines and orders |
| The release suite verdicts and the recorded session | The reviewer: a rule-based model with disclosed rates (pCatch 0.9, pPicky 0.03) |
| The permission, execution and monitoring code | The fault injection (SMT-2 running 30% slow), labeled wherever it appears |

The monitor's validation and the headline story are two separate experiments. The shadow → supervised → limited ladder is a common way to roll out agents; the demotion, recovery and monitoring rules on top of it are this project's own design.

## Start here (5 minutes)

| File | Why it matters |
|---|---|
| [`convex/execute.ts`](convex/execute.ts) | One atomic transaction per execution: dedup, re-check permission and guardrails, then write the approved diff or record a refusal. |
| [`convex/boundary.ts`](convex/boundary.ts) | The shift boundary: close the period, commit any demotion, *then* release the queue. That ordering is why the refusal happens. |
| [`stats/rule.ts`](stats/rule.ts) and [`stats/config.ts`](stats/config.ts) | The monitoring rule, and the configuration frozen before the replay ran. |
| [`checks/guardrails.ts`](checks/guardrails.ts) | Hard guardrails G1–G8, as pure functions that approval can't override. |
| [`docs/SPEC.md`](docs/SPEC.md) | The full design. [`docs/plan.md`](docs/plan.md) records every decision and every real run with its cost. |

## Tech stack

| Layer | Technology |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript (strict) |
| Backend and state | Convex: every state change is a transactional mutation; scheduled fan-out and the shift boundary |
| Auth | Clerk, with `planner` and `qa` roles checked server-side |
| AI | Claude API (`@anthropic-ai/sdk`, pinned), model and settings from the release manifest |
| Validation | Zod schemas for the operator's plan |
| Quality | Vitest + `convex-test` (158 tests, no API calls), Playwright, ESLint, Sentry |
| Hosting | Vercel |

## Run it

**Prerequisites:** Node 20+ and a free [Convex](https://convex.dev) account. Clerk keys for sign-in, and an Anthropic API key only for real model calls.

```bash
git clone https://github.com/juyal-devashish/earned-autonomy.git && cd earned-autonomy
npm install
npm run convex        # your Convex dev deployment; writes .env.local
npm run dev           # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run check` | Type check, lint and the 158 unit and backend tests (no API calls) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run validate:monitor` | Reproduces the monitor validation |

- **Real model calls** need `ANTHROPIC_API_KEY` in the Convex environment (`npx convex env set …`). Each one reserves budget first.
- **Sign-in** needs Clerk keys; [`.env.example`](.env.example) lists every variable and where it goes.
- **Testing a deployed copy:** `E2E_BASE_URL=<site url> NEXT_PUBLIC_CONVEX_URL=<prod url> npm run test:e2e`.

## Repository layout

```
convex/     schema, permissions, approvals, action queue, suite runs, budget, monitor, shift boundary, replay
checks/     guardrails G1–G8, suite checks C1–C4, truth checks, verdicts (pure functions)
sim/        scheduling model, exhaustive oracle, rs-1.0 scenarios, routine snapshots, synthetic reviewer
stats/      binomial test, Clopper–Pearson, EWMA, monitor simulation, frozen config, validation report
operator/   prompt, plan schema, manifests, data view, model call, pricing
app/        public results, evidence and architecture pages, review panel, QA console
tests/      backend tests (convex-test) and Playwright
scripts/    monitor baseline and validation, walkthrough recorder
docs/       SPEC.md (the design) and plan.md (every decision and real run)
```

## License

[MIT](LICENSE) © 2026 Devashish Juyal
