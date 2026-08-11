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
| `main` | Current best state. The only branch Vercel deploys. |
| `og` | Clean baseline, forked from `main`. Do not build on it. |
| `copy-a` | Independent exploration lane. |
| `copy-b` | Independent exploration lane. |
| `hackathon-copy` | Frozen archive of the Aug 7 2026 submission, sponsor integrations intact. **Never commit here.** |

`copy-a` and `copy-b` are free lanes — they may go the same direction or diverge completely. Do not coordinate them, and do not merge one into the other. Tarun decides what reaches `main`.

## Stack

- Next.js (App Router) + TypeScript + Tailwind. Vercel deploys `main` only (`vercel.json` → `git.deploymentEnabled`).
- The engine is an npm-workspace package: `packages/engine` (`@bonsai/engine`) — tree model,
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

Project `bonsai` (`wild-feather-67393800`). Each lane gets its own isolated database so branches cannot clobber each other or production:

| Neon branch | Serves |
|---|---|
| `main` | Vercel production |
| `copy-a` | the `copy-a` lane |
| `copy-b` | the `copy-b` lane |

Connection strings come from the Neon console. Put the one for your lane in `.env.local` as `DATABASE_URL`. **Never point your lane at the `main` Neon branch** — you will overwrite the live demo's tree.

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
- `plugin/mcp/server.mjs` deliberately mirrors a small engine subset (tokens, classifier,
  coverage) because Node can't import the TS engine directly — the engine is the source of
  truth; change both when touching that logic.
- Never send sampling params to 4.6+/5 Claude models, and route effort per BRANCH, not per
  message — resolved effort is rendered into the prompt, so per-turn changes invalidate the
  provider prompt cache.

## Ongoing

Updated: 2026-08-11T07:30:00Z by claude session (lane A)

**Done:**
- Toolchain + lane plan: tsx/vitest/typecheck, `PLAN.md`, `BUILDLOG.md` (`8e9acc8`).
- Engine extracted to `@bonsai/engine` npm-workspace package (packages/engine) with injectable
  inference seam and 59-test suite; dead M0 stubs deleted (`26f64b2`). Review: no HIGH/CRITICAL.
- Engine semantics made true (`ded8651`): path-based compile (parent brief + insights +
  anchor-scoped transcript — briefs compose recursively, depth≥2 referents verified live),
  merge loop closed (insights enter chat context + sibling compiles), context-first escalation
  (classifier judges brief coverage; widen-before-upgrade; manual picks never overridden),
  brief token budget, anchored forks, persisted branch pins. 93 tests.
- Live provider fixed + honest accounting (`1f768b3`): per-model param policy (sampling 400s on
  5-family — 3 of 4 rungs were silently mocking with a live key), real `output_config.effort`,
  effort-keyed max_tokens/timeouts, Fable refusal handling, verified pricing (old table
  overstated savings ~3x), servedBy-rate pricing for OpenAI/xAI. 99 tests.

**Decided (research-backed, sources in BUILDLOG):**
- Surface: **Claude Code plugin primary** (full loop on the user's Pro/Max subscription —
  sanctioned), claude.ai remote-MCP connector fast-follow (state+briefs+MCP-Apps tree UI only;
  no sampling there), Chrome extension **cut** (auto-send = the pattern behind the April 2026
  account bans).
- Positioning: on the loop (compiled briefs + per-branch routing + distilled merge-back —
  unclaimed by any shipped product), not the tree (commoditized).

**Done (continued, same session):**
- Segment 4 (`abdc262`): relational Neon store (per-row, migrations/, restart-survival PROVEN,
  commit failures 503), zod route boundary, guarded reset. Security review: no HIGH/CRITICAL;
  its two LOW fixes applied.
- Segment 5 (`837c805`): eval harness — 7/7 incl. the depth-2 referent proof through composed
  briefs; GitHub Actions CI gating typecheck+tests+evals+build.
- Segment 6 (`2d3d03d`): **working Claude Code plugin** in `plugin/` + root marketplace.json —
  verified end-to-end headless (fork → honest punt → widen → merge at 97.6% pruned) on
  subscription auth. MCP tree server smoke 12/12.
- Segment 7 (`32076e1`..`3362e64`): web demo truth pass (visible errors, server-truth pins,
  markdown, insights strip, truth badges, honest economics), PRODUCT.md rewritten as
  spec+roadmap, README/AGENTS updated, DEMO.md comment sweep. React+TS reviews: both HIGHs
  fixed (pending-mode race, alert semantics) + both MEDIUMs (memoized markdown bubbles,
  focusable routing card). CI green.

**In flight:** nothing — all planned segments shipped.

**Blocked:** nothing.

**Next (candidates for a fresh session, Tarun picks):**
1. Dogfood the plugin in real Claude Code sessions; polish the skill flow from friction found.
2. Live-key eval grading (needs ANTHROPIC_API_KEY in .env.local — hook-blocked for agents,
   hand Tarun the command) to grade real compiler output vs the mock gate.
3. claude.ai connector (remote MCP + MCP Apps tree UI) — hosting + OAuth groundwork.
4. Extract `@bonsai/engine` publishable (add exports conditions/build), marketplace repo split
   for the plugin, skillrank.dev listing.
5. Streaming chat for the web demo.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
