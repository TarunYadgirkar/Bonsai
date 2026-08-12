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
  truth; change both when touching that logic. The plugin runs the *bundled*
  `plugin/mcp/dist/server.mjs` (self-contained so a marketplace clone needs no npm install);
  after editing `server.mjs`, rebuild it with `node plugin/mcp/build.mjs` and commit the bundle.
- Never send sampling params to 4.6+/5 Claude models, and route effort per BRANCH, not per
  message — resolved effort is rendered into the prompt, so per-turn changes invalidate the
  provider prompt cache.

## Ongoing

Updated: 2026-08-12T01:25:00Z by claude session (lane A)

### ▶ NEXT SESSION — do these first
1. **Promote to production.** Migrate the LIVE Neon branch `br-old-fog` with `migrations/004`
   (two `ALTER … ADD COLUMN session_id` + two `CREATE INDEX`; the DELETE is optional) in the Neon
   console — the auto-mode classifier blocks DDL on that branch from here. Then `vercel --prod`
   from `~/TarunsCode/bonsai-copy-a` (worktree linked to bonsai-connector). Migration MUST land
   before the deploy or new-code writes 503.
2. **(Optional) real models on the deploy.** `vercel env add ANTHROPIC_API_KEY preview`, then
   redeploy the preview — flips it from the extractive mock to real Fable/Opus/Sonnet/Haiku (BYOK,
   bills the API account, not the subscription).
3. **Finish the extension smoke** (only unverified piece): confirm selection→Compile→Open branch
   chat prefills the brief and NOTHING sends. Two ways:
   - **(a) Local Playwright harness** — write a script (`extension/test-e2e.mjs` or similar) that
     launches Chromium with `--load-extension=extension/`, reaches the extension **service worker**
     to seed `chrome.storage.session[PENDING_KEY]`, opens `claude.ai/new`, and asserts the composer
     prefilled + no send fired. This covers the whole prefill/never-send path AND the compile logic
     (drive `compile.ts`/`store.ts` directly) — everything EXCEPT the literal side-panel button
     clicks (`chrome.sidePanel` isn't page-addressable even locally). Claude Code CAN build + run
     this from Bash.
   - **(b) Screen-level** — Cowork's local computer use (next session is on the **Desktop app**,
     where Cowork is available) or a human clicks the actual panel buttons. Claude Code can't invoke
     Cowork itself.
   Do (a) for regression coverage; (b) once to confirm the real panel UI end-to-end.

Note: next session runs on the **Claude Desktop app** (Cowork available there for the panel smoke).

**Session 2026-08-11 PM — audit + fixes (7 commits on copy-a, all gates green: 172 tests, 10/10
evals, build clean). A 56-agent adversarial review surfaced 36 verified bugs; the load-bearing
ones are fixed:**
- **Web app is now per-session** (`lib/session.ts` cookie + `session_id` column, `migrations/004`).
  A fresh visitor lands on an EMPTY root that answers from its own transcript; the Berkeley fixture
  is an opt-in demo (`/api/demo`, "Load Berkeley demo" button), no longer preloaded for everyone.
  `/api/reset` empties the caller's own garden. Store rewritten around this; a memory-fallback
  working set now refuses to write back over a DB that only failed to READ (was clobbering rows).
- **Connector auth fails closed**: `validateKey` rejects the repo-literal `bonsai-dev-key` whenever
  DATABASE_URL is set and rejects (not memory-falls-back) on a DB error; the sticky `degraded` flag
  is now a 30s cooldown. Per-key node cap + parentId ownership check on fork; path key is canonical
  (a bearer can't mask/rewrite it). Dev-key seed removed from `migrations/003`.
- **Learning router**: feedback attributed to the classifier's PRE-adjustment tier
  (`RoutingDecision.classifiedTier`) so a bad learned shift self-corrects; an inherited pin no
  longer re-logs an override every turn (was fabricating a "consistent pattern").
- **Accounting**: `buildLog` persists the engine's real per-attempt cost (`routing.estCostUsd`,
  which includes escalation passes + `costForServedBy`) instead of a catalog reprice.
- **Plugin** MCP server is bundled self-contained (`plugin/mcp/dist/server.mjs`); install needs no
  npm step. Rebuild with `node plugin/mcp/build.mjs` after editing `server.mjs`. Also: cross-process
  store lock, coverage retry supersedes phantom siblings, routed effort rendered into the subagent
  prompt, insight cap 20 everywhere.
- **Engine** (2nd pass): fork anchors honoured + fail closed on unknown anchor; mock compiler
  carries the inherited brief forward instead of injecting the Berkeley fixture (depth-2 proof is
  genuine now); non-string facts filtered before the empty-brief gate; provider propagates a caller
  abort; baseline scaled onto the strong model's 1.3x tokenizer.
- **Extension**: session storage opened to the content script (prefill worked-around no-op), fresh-
  chat link guard, selection-tab guard, orgId UUID validation, per-kind feedback, **structural
  never-send** (esbuild stub — zero model-POST code in the bundle), dropped `tabs` permission.
- **Web UI**: failed-send draft survives a branch switch; routing chip no longer flickers to Auto.
- **Garden artifact** reworked into a real left-to-right tree diagram (same URL b1b44d60).

All 36 adversarially-verified findings from the audit are now fixed on copy-a (173 tests, 10/10
evals, plugin smoke 12/12, both builds green). Two were left deliberately, documented in place: the
MCP connector's open CORS/origin (claude.ai's initialize breaks with strict validation) and the
per-session routing-profile read-modify-write (last-write-wins; negligible contention per session).

**BLOCKED — deploy the above to the live connector (needs Tarun; the auto-mode classifier blocked
me from running DDL on the live Neon branch):**
1. Apply `migrations/004_sessions.sql` schema to the copy-a Neon branch `br-old-fog-avfznwqu`
   (the two `ALTER TABLE … ADD COLUMN session_id` + two `CREATE INDEX`; the DELETE of `legacy`
   rows is optional — session-scoped reads already hide them). Do it in the Neon console or a
   psql the classifier isn't gating.
2. `vercel --prod` from `~/TarunsCode/bonsai-copy-a` (worktree is linked to `bonsai-connector`).
3. Re-verify: fresh web session is empty; `bonsai-dev-key` → 401; real key still inits + fork/merge.
Migration MUST land before the deploy or new-code writes 503 (no session_id column yet).

**Live-deployed + tested (2026-08-12).** New code on a **preview** deploy with a migrated Neon
branch: https://bonsai-connector-kqdihj0ni-taruns-projects-248def65.vercel.app
(`-e DATABASE_URL=` → `br-small-mode-avqh6i55`; production bonsai-connector.vercel.app UNTOUCHED +
verified healthy). Full loop driven via Playwright: per-session empty root, routing (open-ended
escalates, brief-covered lookup → Haiku Low), select→branch→brief (85%+ pruned)→merge→persists on
reload; economics ledger shows the cost fixes. Web deploy is MOCK (no ANTHROPIC_API_KEY) — real
models need a key (`vercel env add ANTHROPIC_API_KEY preview`, then redeploy). To promote to prod:
migrate the LIVE branch `br-old-fog` (classifier blocked my DDL there — do it in the Neon console)
then `vercel --prod`.

**Extension** loaded unpacked + verified live: content script injects, Branch chip appears on
selection and dismisses cleanly (chip-clear fix). **NOT verified:** the side panel's own buttons
(Compile / Open branch chat) — Chrome's side panel is browser chrome, not page DOM, so page-scoped
browser automation (Playwright, claude-in-chrome) can't click it. Cowork's local screen-level
computer use CAN (Claude Code can't invoke Cowork), or a human. Rebuild after edits:
`node extension/build.mjs`, then ↻ on the chrome://extensions card.

**Bonsai is a four-surface product with a defensible engine, a designed UI, and OSS-grade docs.**

Engine `@bonsai/engine` (dependency-free, 168 unit tests + 10/10 evals, npm-publishable via
`pnpm publish` → tsup `dist`; injectable logger; live-provider tests):
- Path-based compile (briefs compose; depth-2 referents proven), closed merge loop,
  context-first escalation, honest per-model pricing.
- **Salience compiler**: rarity + recency + role + topic scoring (a raw keyword count would drop
  the answer — see the stipend eval), and a strengthened live compile prompt.
- **Learning router v2**: PER-QUESTION-KIND priors + classifier `kind`+`confidence` (confidence
  gates shifts, blocks risky down-shifts) + `mergeProfiles()` **community cold-start** (the
  network-effect moat). Routes feed `questionKind`; RoutingChip shows kind/confidence/learned.
- **Rigorous stats** (`stats.ts`): tokenizer-generation 1.3x correction, measured-vs-modeled
  provenance, per-purpose/per-model spend, savings curve.

Surfaces (all ride subscriptions, zero API keys):
- Claude Code **plugin** — full loop; marketplace install verified.
- Chrome **extension** — MV3, strictly HITL (reads + prefills, never sends); light-theme panel.
- **MCP connector** — deployed bonsai-connector.vercel.app, connected + proven in-chat in Tarun's
  claude.ai (Max). Neon `mcp_*`.
- **Web app** — REDESIGNED (sumi-e ink on rice paper, the garden signature, season cost scale;
  see DESIGN.md), deployed live. Shareable interactive garden artifact published.

Docs / OSS: recruiter README (live screenshot), `MOAT.md` (per-user + cross-user routing flywheel
+ owning the brief-fidelity benchmark), `BENCHMARK.md`, CONTRIBUTING, engine README+CHANGELOG,
PRODUCT.md reconciled. CI gates typecheck (root+extension), tests, evals, both builds, engine dist
smoke.

**In flight:** nothing.

**Blocked:** deploy of this session's fixes to the live connector — see the PM-session block above
(needs Tarun to run the Neon migration + `vercel --prod`; classifier gated live DDL).

**Next (Tarun picks):**
0. Land the blocked deploy (migration + `vercel --prod`) so per-session + the auth fix go live.
1. Promote copy-a → `main`/the live demo when ready (bonsai-lac still runs the old build).
2. Ship the population-prior aggregation pipeline server-side (the `mergeProfiles` mechanism is
   built + tested; the anonymized cross-user data plumbing is the moat's remaining work).
3. Publish the brief-fidelity benchmark publicly; expand scenarios.
4. `pnpm publish` `@bonsai/engine`; MCP Apps interactive tree inline in claude.ai (connector
   already returns structuredContent); connector OAuth; streaming chat.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
