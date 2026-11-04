# EvosDemo

A release suite, permission system and production monitor for one AI scheduling operator in a simulated PCB factory. It's an independent work sample for the Evos Product & AI Quality Engineer role, not an Evos product.

- **Live:** https://evosdemo.vercel.app. Results and evidence are public; Review and QA need a signed-in planner or qa account.
- **Walkthrough (2 min):** [Loom link]

The operator (Claude Opus 5.5) earns autonomy step by step: **shadow → supervised → limited**. It loses it automatically when production reviews go bad.

## The two acts

**1. Release gate (real AI runs).** Each operator release runs the same suite, `rs-1.0`: 8 factory scenarios × 10 trials.

| Release | Verdict |
|---|---|
| `op-v1`: its data view lacks observed machine cycle times | **Failed:** C4 on slow-machine, 10/10 trials; T1 on conflicting-priorities, 8/10 |
| `op-v2`: the fix, which includes observed cycle times | **Passed** rs-1.0, 80/80 |

**2. Fault-injection replay (labeled as such).** What if a defect like op-v1's slipped past the gate? In an isolated session, op-v1 is deliberately given limited autonomy, and from day 4 SMT-2 runs 30% slow.
- The synthetic reviewer's agreement falls from 17/17 to 0/17.
- The monitor's binomial test signals and demotes op-v1.
- At the next shift boundary, the backend **refuses its queued action**, and the [evidence viewer](https://evosdemo.vercel.app) shows the whole chain behind that refusal.
- **Recovery:** op-v2 earned 78/80 fresh supervised reviews (95% lower bound 0.923, above the 0.90 floor), and qa authorized it back to limited autonomy.

## What's real and what's simulated

- **Real:** every operator proposal is a real Claude API call, and spend is capped at $18 by an atomic budget reservation. About $7 has been spent in total.
- **Simulated:** the factory, machines, orders and reviewer are synthetic. The reviewer is a rule-based model with disclosed rates (pCatch 0.9, pPicky 0.03), not independent validation.
- **Two separate experiments:** the monitor's validation (0.2% false demotions, 97.6–100% detection) comes from resampled recorded proposals. The headline story comes only from the recorded session.
- **Rules:** demotion, recovery and monitoring rules are this project's own design, not Evos's.

## Start here (5 minutes)

| File | Why it matters |
|---|---|
| [`convex/execute.ts`](convex/execute.ts) | One atomic transaction per execution. It deduplicates, re-checks permission and guardrails, then writes exactly the approved diff or records a refusal. |
| [`convex/boundary.ts`](convex/boundary.ts) | The shift boundary: close the period, commit any demotion, *then* release the queue. That ordering is why the refusal happens. |
| [`stats/rule.ts`](stats/rule.ts) and [`stats/config.ts`](stats/config.ts) | The monitoring rule, and the configuration frozen before the replay ran. |
| [`checks/guardrails.ts`](checks/guardrails.ts) | Hard guardrails G1–G8, as pure functions that approval can't override. |
| [`docs/SPEC.md`](docs/SPEC.md) | The full design. [`docs/plan.md`](docs/plan.md) records every decision and every real run with its cost. |

## Stack

TypeScript, Next.js 16, Convex (all state changes are transactional mutations), Clerk (`planner` and `qa` roles), Sentry, Vitest + `convex-test`, Playwright, and the Claude API (`@anthropic-ai/sdk`, pinned).

## Run it

```bash
npm install
npm run convex        # your Convex dev deployment; writes .env.local
npm run dev           # http://localhost:3000
npm run check         # typecheck + lint + 155 unit/backend tests (no API calls)
npm run test:e2e      # Playwright
```

- **Real model calls** need `ANTHROPIC_API_KEY` in the Convex environment (`npx convex env set …`).
- **Sign-in** needs Clerk keys; `.env.example` lists every variable and where it goes.
- **Testing the deployed site:** `E2E_BASE_URL=https://evosdemo.vercel.app NEXT_PUBLIC_CONVEX_URL=<prod url> npm run test:e2e`.
- **Monitor validation:** `npm run validate:monitor` reproduces it.

## Where things are

| Path | Contents |
|---|---|
| `convex/` | Schema, permissions, approvals, the action queue, suite runs, budget, monitor, shift boundary, replay |
| `checks/` | Guardrails G1–G8, suite checks C1–C4, truth checks, verdicts (pure functions) |
| `sim/` | Scheduling model, exhaustive oracle, rs-1.0 scenarios, routine snapshots, synthetic reviewer |
| `stats/` | Binomial test, Clopper–Pearson, EWMA, monitor simulation, frozen config, validation report |
| `operator/` | Prompt, plan schema, manifests, data view, model call, pricing |
| `app/` | Public results, evidence and architecture pages, review panel, QA console |
| `tests/` | Backend tests (`convex-test`) and Playwright |
| `scripts/` | Monitor baseline and validation, walkthrough recorder |
| `docs/` | Spec and build plan |
