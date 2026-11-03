# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository.

## Project

**EvosDemo:** a release suite, permission system and production monitor for one AI scheduling operator in a simulated PCB factory.

- **[SPEC.md](docs/SPEC.md) is the source of truth.** Read the relevant section before changing behavior. If code and spec disagree, flag it; don't silently pick one.
- Build in the order of SPEC §14 (hardest guarantee first). Don't start UI work before the backend guarantees and their tests pass.
- **For any UI work, follow [UI-GUIDE.md](docs/UI-GUIDE.md):** palette and CSS tokens (§3, §11), typography (§4), layout (§5), the operator card (§7) and the evidence panel (§9). Check finished screens against its review checklist (§13). Inspired by Evos's public site, the project must use its own branding: no Evos logo, and never present it as an official Evos product.

Stack: TypeScript (strict), Next.js/React, Convex (including scheduled fan-out and the shift boundary, instead of SPEC §2's Inngest; see docs/plan.md steps 4 and 7), Clerk, Sentry, Playwright, Vitest + `convex-test`, Vercel, Claude API (`@anthropic-ai/sdk`, version pinned).

## Working style

- The user's current request controls scope. Resolve routine choices from the spec and the existing code. Ask only when a missing answer would change the result.
- Work in small steps. After each behavior change, run the focused tests, fix failures before building on them, and commit.
- Inspect the current implementation before describing a feature as working. Scaffolds, plans and passing type checks are not evidence that something works.
- Preserve unrelated changes. Don't refactor code outside the task.
- At each checkpoint, briefly report what changed, what was tested, the actual result, and any remaining limitation.

## Git workflow

- **Commit after every completed step** (a spec build step, a feature, a fix, a refactor, or a test addition). Don't wait to be asked.
- Keep each commit focused on one logical change. Use a clear message in the imperative mood, saying what changed and why, e.g. `Add atomic executeAction with dedup and refusal logging`.
- Run the relevant tests before committing. Don't commit failing tests unless the commit message says why (e.g. a deliberately failing test added before its fix).
- Work on a feature branch for multi-step work. Don't commit directly to `main` once it exists with history.
- Check `git status` and the staged diff before each commit, so nothing unintended is included.
- Never commit secrets, `.env*` files (except `.env.example`), API keys, `node_modules/`, build output, test traces or evidence exports.
- **Commit and push after every file edited** (the user's standing instruction). If one file alone would break type checks, commit the smallest set of files that keeps the tree green. Push to `origin` immediately after each commit. When a step's done criteria pass, merge its branch into `main` and push `main`.
- Don't deploy or publish without the user's authorization. Never force-push or rewrite published history.

## Engineering practices

**TypeScript**
- `strict` on. No `any` without a comment explaining why. Prefer types inferred from Zod schemas over duplicated interfaces.
- Use the SDK's own types (`@anthropic-ai/sdk`, Convex generated types) instead of redefining them.

**Correctness rules from the spec (don't weaken these):**
- All business-state changes happen inside Convex mutations. `executeAction` is **one atomic transaction** (SPEC §9.5).
- **Refusals return normally and are recorded.** Never throw for an expected refusal, because a thrown mutation rolls back the refusal log.
- Checks (`checks/`) are **pure functions** with no I/O and no AI calls. Each has a passing and a failing fixture.
- Guardrails can't be overridden by approval. Shadow mode never executes.
- Every mutating Convex function checks the caller's role server-side (`requireRole`). Hiding a button is not access control.
- Every number on screen is rendered from structured data, never parsed from model prose.
- Missing, incomplete or budget-blocked checks and trials are **never treated as passing**.

**Tests**
- Tests must be deterministic: seeded RNG, simulated clock, stored proposals. **Tests never call the Claude API.**
- Never loosen a test, tolerance or threshold just to make it pass. If a test looks wrong, explain why and ask.
- The SPEC §13 mandatory test list must stay green.
- Rerunning the same model is a diagnostic, not independent validation.

**AI calls and cost**
- Model and settings come from the manifest (default `claude-opus-5-5`, `effort: "low"`). Don't hard-code them elsewhere.
- Every call goes through the budget reservation (SPEC §11). Hard cap $18. Don't bypass it for "quick tests."
- Ask before running anything that makes more than ~10 real API calls (suite runs, pools, recorded sessions).
- Record refusals, timeouts and parse failures as failed attempts. Never drop them.

**Statistics and claims**
- Freeze monitoring thresholds and baselines in config **before** running the data they apply to. Don't retune to get a nicer result.
- Label synthetic data, the synthetic reviewer and fault-injection sessions everywhere they appear (UI, README, charts).
- Don't present simulated results as measured performance, and don't describe this as Evos's implementation (SPEC §1, §15).

**Code hygiene**
- Small modules matching the repo layout in SPEC §16. Match the surrounding code's naming and comment density.
- Handle errors explicitly. Log useful context, never secrets or full prompts containing keys.
- Run lint, type check and the relevant tests before each commit. Read your own final diff before reporting a step as done.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev: Next.js | `npm run dev` |
| Dev: Convex (local deployment, regenerates `convex/_generated/`) | `npm run convex` |
| Regenerate Convex types only | `npx convex codegen` |
| Type check (Next route types + app + `convex/`) | `npm run typecheck` |
| Lint | `npm run lint` |
| Unit + backend tests (Vitest + `convex-test`) | `npm test` |
| Single test file / test name | `npx vitest run tests/backend/<file>.test.ts -t "<test name>"` |
| E2E (starts `npm run dev` itself) | `npm run test:e2e` |
| Single E2E test | `npx playwright test tests/e2e/<file>.spec.ts -g "<test name>"` |
| Check before commit | `npm run check` (typecheck + lint + test) |

Testing notes:
- `convex-test` runs in the `edge-runtime` Vitest environment. Backend tests import Convex modules through [tests/backend/modules.ts](tests/backend/modules.ts), which globs `convex/` including `_generated/`.
- `convex/_generated/` is committed. Rerun `npx convex codegen` (or keep `npm run convex` running) after changing `convex/` files, or type checks and tests break.
- Playwright browsers are installed separately: `npx playwright install chromium`.

## Secrets

- `ANTHROPIC_API_KEY`, Clerk and Sentry keys live in `.env.local` and in Convex/Vercel environment settings. Keep `.env.example` updated with variable **names only**.
- The Anthropic key is used only server-side (Convex actions), never in browser code.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
