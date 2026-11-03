# Earned Autonomy

A release suite, permission system and production monitor for one AI scheduling operator in a simulated PCB factory. It's an independent work sample for the Evos Product & AI Quality Engineer role, not an Evos product.

**Live:** https://evosdemo.vercel.app (results and evidence are public; Review and QA need a signed-in planner or qa account)

The operator (Claude Opus 5.5) earns autonomy step by step: **shadow → supervised → limited**. It loses it automatically when production reviews go bad.

## The two acts

**1. Release gate (real AI runs).** Each operator release runs the same suite, `rs-1.0`: 8 factory scenarios × 10 trials.

| Release | Verdict |
|---|---|
| `op-v1`: its data view lacks observed machine cycle times | **Failed:** C4 on slow-machine, 10/10 trials; T1 on conflicting-priorities, 8/10 |
| `op-v2`: the fix, which includes observed cycle times | **Passed** rs-1.0, 80/80 |

**2. Fault-injection replay (labeled as such).** What if a defect like op-v1's slipped past the gate? In an isolated session, op-v1 is deliberately given limited autonomy. From day 4, SMT-2 runs 30% slow. The synthetic reviewer's agreement falls from 17/17 to 0/17, and the monitor's binomial test signals and demotes op-v1. At the next shift boundary, the backend **refuses its queued action**. The evidence viewer shows the whole chain behind that refusal. Recovery: op-v2 earned 78/80 fresh supervised reviews (95% lower bound 0.923, above the 0.90 floor), and qa authorized it back to limited autonomy.

## What's real and what's simulated

- **Real:** every operator proposal is a real Claude API call, and spend is capped at $18 by an atomic budget reservation. About $7 has been spent in total.
- **Simulated:** the factory, machines, orders and reviewer are synthetic. The reviewer is a rule-based model with disclosed rates (pCatch 0.9, pPicky 0.03), not independent validation.
- **Statistics come from two separate experiments.** The monitor's validation (0.2% false demotions, 97.6–100% detection) is from resampled recorded proposals. The headline story comes only from the recorded session.
- **Rules:** demotion, recovery and monitoring rules are this project's own design, not Evos's.

## Stack

TypeScript, Next.js 16, Convex (all state changes are transactional mutations), Clerk (`planner` and `qa` roles), Sentry, Vitest + `convex-test`, Playwright, and the Claude API (`@anthropic-ai/sdk`, pinned).

## Run it

```bash
npm install
npm run convex        # local Convex backend; writes .env.local
npm run dev           # http://localhost:3000
npm run check         # typecheck + lint + unit/backend tests (no API calls)
npm run test:e2e      # Playwright
```

`npm run convex` targets your personal Convex dev deployment. Production runs on Vercel plus the Convex production deployment; to test it, run `E2E_BASE_URL=https://evosdemo.vercel.app NEXT_PUBLIC_CONVEX_URL=<prod url> npm run test:e2e`.

Real model calls need `ANTHROPIC_API_KEY` set in the Convex environment (`npx convex env set …`). Sign-in needs Clerk keys; see `.env.example`.

## Where things are

| Path | Contents |
|---|---|
| `SPEC.md` | The design. Source of truth. |
| `plan.md` | Build steps, what was decided, and every real run with its cost |
| `convex/` | Schema, the atomic `executeAction`, permissions, suite runs, monitor, shift boundary |
| `checks/` | Guardrails G1–G8, suite checks C1–C4, truth checks (pure functions) |
| `sim/` | Scheduling model, oracle, scenarios, synthetic reviewer |
| `stats/` | Binomial test, Clopper–Pearson, EWMA, monitor validation report |
| `operator/` | Prompt, plan schema, manifests, model call, pricing |
