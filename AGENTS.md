# AGENTS.md — rules for coding agents in this repo

## What this is

Bonsai: tree-structured AI chat. Branch a side question off a parent conversation with a *compiled minimal context brief* instead of the full history; route each request to a model + effort level automatically, with manual override; cherry-pick insights back into the parent. Read `PRODUCT.md` for the idea.

The hackathon is over. This is now a real project being taken toward something usable and open source.

## The part that matters

The surface (web app / browser extension / CLI plugin) is undecided. The durable value is the layer underneath it:

- the tree data model,
- how context is **assembled from a path** through that tree,
- what happens when you fork: which ancestors get sent, which get pruned, how two branches merge back.

That is the interesting problem and the thing worth getting right. Surfaces are thin once it is solid. Prefer changes that strengthen that core over changes that only decorate one surface.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Current best state. The only branch Vercel deploys. Work happens here. |
| `og` | Clean baseline, forked from `main`. Do not build on it. |

The `copy-a`/`copy-b` exploration lanes were collapsed into `main` on 2026-09-17 (copy-a was
identical to main; copy-b never diverged beyond its lane brief). The frozen Aug 7 2026 hackathon
submission lives in the private `TarunYadgirkar/bonsai-hackathon` repo, sponsor integrations intact.

## Stack

- Next.js (App Router) + TypeScript + Tailwind. Vercel deploys `main` only (`vercel.json` → `git.deploymentEnabled`).
- The engine is an npm-workspace package: `packages/engine` (`bonsai-engine`) — tree model,
  path assembly, brief compiler, router, providers. Zero runtime deps; ships as TS source
  (`transpilePackages` in next.config.ts). Unit tests in `packages/engine/test`, evals in
  `evals/` (`npm run eval`).
- Inference: `packages/engine/src/provider.ts`. One of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
  `XAI_API_KEY` makes it live; none means the extractive mock in `packages/engine/src/llm.ts`.
  Request bodies come from per-model capability records — never hand-build one.
- Store: relational Neon Postgres (conversations/messages/insights/inference_logs — schema in
  `migrations/`) via the working-set API in `lib/store.ts`; in-memory fallback with fixture
  seeding when `DATABASE_URL` is unset.
- The Claude Code plugin lives in `plugin/` (skills + tier agents + bundled stdio MCP tree
  server); repo root carries the marketplace manifest.

There is deliberately **no durable-memory layer** right now. The hackathon one was a sponsor integration and was removed; whether cross-conversation memory is needed at all, and what should provide it, is an open question. Do not add one back without deciding that first.

### Neon — one database branch per git branch

Project `bonsai` (`wild-feather-67393800`). Local development gets its own isolated database so it cannot clobber production:

| Neon branch | Serves |
|---|---|
| `main` | Vercel production |
| `local-dev` | Tarun's laptop |

Connection strings come from the Neon console. Put the `local-dev` one in `.env.local` as `DATABASE_URL`. **Never point local dev at the `main` Neon branch** — you will overwrite the live demo's tree.

## Mock-first rule

Every external dependency sits behind an interface with a mock that activates automatically when its env vars are missing. The engine's mock answers extractively with real token math; the store falls back to in-memory with fixture seeding. The app must fully run with zero keys configured.

**Persistence honesty:** a wrong `DATABASE_URL` still degrades reads to memory silently (a
load failure must not take the demo down), but writes no longer lie — `commit()` reports
failure and mutating routes return 503. Confirm persistence with a restart-survival test all
the same.

## Working rules

1. Build clean before committing: `npm run build`, plus `npm run typecheck && npm run test`
   (and `npm run eval` when engine semantics changed). Fix every error.
2. Commit messages: conventional prefix, short imperative subject, nothing else. **No `Co-Authored-By:` trailers, no generated-with footers, no bulleted change lists.**
3. No refactors outside the current task.
4. Keep it boring: fetch + JSON, plain React state. No exotic dependencies without a reason.
5. Secrets only via env. `.env.example` lists the names. Never print keys. Agents cannot read or write `.env*` here — two `PreToolUse` hooks block it; hand Tarun the command instead.
6. Errors from any external service: catch, log one line, degrade. Nothing crashes on a 4xx.
7. `lib/types.ts` and the API route signatures are shared contracts. Changing one is a deliberate act, not a side effect.

## Known traps

- `components/TreeSidebar.tsx` geometry: card heights are fixed per variant and `components/treeLayout.ts` must agree with them. Change one, change both.
- A node's chip shows the **last** turn's decision, so adding a cheap follow-up turn to a fixture branch overwrites its chip.
- `fixtures/seed-tree.json` is generated, never hand-edited. Regenerate with `DATABASE_URL= npx next dev -p 3111` then `npx tsx scripts/build-seed-tree.ts`.
- `plugin/mcp/server.mjs` imports the REAL engine ('bonsai-engine', aliased to the TS source in
  build.mjs) — the old hand-mirrored subset is gone, and with it the dual-maintenance trap.
  Consequence: server.mjs only runs BUNDLED; `node plugin/mcp/dist/server.mjs` is the artifact,
  and the smoke exercises it. After editing server.mjs or the engine, rebuild with
  `node plugin/mcp/build.mjs` and commit the bundle (CI diffs it).
- Never send sampling params to 4.6+/5 Claude models, and route effort per BRANCH, not per
  message — resolved effort is rendered into the prompt, so per-turn changes invalidate the
  provider prompt cache.

## Ongoing

Updated: 2026-09-21 by claude session — landscape re-read + cache-warm baseline landed

Done (2026-09-21):
- Verified: Claude Code `/fork` is a round-trip full-transcript background subagent since
  v2.1.232 (merge-back sherlocked); no native brief, routing, or tree. Sonnet 5 is $2/$10 for
  good; Fable 5.1 is the ceiling with $0.25 cache reads.
- Engine: `cacheRead` on every ModelSpec, `warmBaselineCostUsd`/`warmBaselineOf`, Sonnet 5 rate
  fixed, ceiling upstream `claude-fable-5-1` (catalog id unchanged). Ledger shows the warm
  baseline. Docs repositioned (README, PRODUCT, MOAT, ROADMAP landscape section, evals/README).
- All gates green locally (237 tests, 15/15 evals, smoke 17/17, both dists rebuilt, build clean).

Next:
1. README comparison table (Bonsai vs /fork vs /btw vs /branch vs ChatGPT branch) — promoted.
2. Plugin: lean into what native cannot do — cross-model routing line in the fork result, and a
   SessionStart "N open branches" nudge. Consider silencing the side-question hook when the
   user already typed `/btw`.
3. Still queued: `vercel env add SESSION_SECRET production`, `npm publish bonsai-engine`, MCP
   Apps interactive garden.

Previous entry (2026-09-17): lanes collapsed; single-branch workflow on `main`

Done (2026-09-17):
- `main` already contained everything from `copy-a` (fast-forward landed). Deleted branches
  `copy-a`, `copy-b`, `hackathon-copy`, `main-pre-phase4` locally and on GitHub; removed the
  `~/TarunsCode/bonsai-copy-a` / `bonsai-copy-b` worktrees; dropped `LANE.md`. Hackathon
  snapshot survives verbatim in private repo `TarunYadgirkar/bonsai-hackathon`.
- `~/TarunsCode/bonsai/.vercel` now links to the `bonsai-connector` project (prod), which used
  to live only in the copy-a worktree. `bonsai-lac` still auto-deploys from git.
- Neon branches `copy-a`/`copy-b` are orphaned and can be deleted in the console.

Previous entry (2026-08-23):

Done:
- `e48c176` fix: never merge a user turn as the distilled insight. Root cause of the legacy
  question-insights (hackathon-day mock distiller): pre-`5725f5d` had no question filter, and
  the filter added there only catches `?`-suffix, so period-terminated imperatives slipped
  through. Two-layer fix: engine `mockDistill` considers assistant-authored sentences only
  (`sentencesWithRole`), and new exported `insightEchoesUserTurn` (compiler.ts) rejects
  distilled lines that normalize-match a user turn — wired into `app/api/merge/route.ts` beside
  the grounding gate (covers real-model echoes too, which the grounding gate passes by
  construction). 232/232 tests, 15/15 evals, build clean, plugin MCP dist rebuilt + committed.
  Prod Neon data was already clean (0 insights on main).
- Real-data corpus exported to `~/TarunsCode/bonsai-distill-corpus/` (conclusions.jsonl,
  eval.jsonl, README with provenance) for the bonsai-distill experiment. Entire real insight
  population = one fact cluster; the two question-rows were excluded and are what triggered the
  fix above.
- Mahogany hackathon repo moved `hackathons/` → `archive/mahogany-mongodb` (same loop as
  Bonsai, collapsed per Tarun).

Blocked:
- Fast-forward of `main` to `e48c176` + push: auto-mode classifier blocks agent-run pushes to
  main; Tarun runs `cd ~/TarunsCode/bonsai && git merge --ff-only copy-a && git push origin main`
  (then his usual `npx vercel promote` for bonsai-connector prod).
- Mahogany's real Atlas insights for the corpus: connection string lives in hook-blocked `.env`.

Next:
1. After Tarun pushes main: confirm bonsai-lac auto-deploy picked up `e48c176`, then promote
   bonsai-connector prod (Tarun-typed).
2. Still queued from before: `vercel env add SESSION_SECRET production` (+ redeploy),
   `pnpm publish bonsai-engine`, MCP Apps tree UI, connector OAuth.

Standing:
- Run the FULL CI sequence locally before pushing (Tarun asked — no more failure emails):
  typecheck, extension tsc+build+dist-diff, `npm ci --prefix plugin/mcp` + smoke + build +
  dist-diff, tests, evals, build, engine tsup smoke.

