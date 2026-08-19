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

Updated: 2026-08-19T03:20:00Z by claude session (lane A)

### ▶ NEXT SESSION — do these first
-1. **PROD IS CURRENT (2026-08-19)** — Phase 4 + wave 2 + panel fixes are LIVE on
   bonsai-connector.vercel.app (preview deploy via CLI, Tarun promoted `dao2h6odb` in-session;
   the auto-mode classifier blocks agent-run `vercel --prod`/`promote`, so future prod flips are
   a Tarun-typed `! npx vercel promote <preview-url> --yes` after an agent `vercel deploy`).
   Verified live: SSE chat + regenerate streams, truncation persists, export, session-scoped
   guards, onboarding + demo ribbon. Still queued: `vercel env add SESSION_SECRET production`
   (+ redeploy) to turn on signed cookies; connector auto-routing now live on prod.
0. **Extension is PARKED (Tarun, 2026-08-19)** — real-Chrome testing showed `sidePanel.open()`
   silently refused even with the stash+toast fallbacks, and the surface can never run the full
   loop anyway (HITL by design; auto-send = account-ban pattern). Matches PLAN.md's original
   "Cut" verdict. Both e2e suites stay green as regression cover, but no further investment.
   The claude.ai surface is the CONNECTOR — full fork→branch→merge loop verified live in
   Tarun's claude.ai this session (brief 76.4% pruned, garden totals 99.6%).
1. **Promote prod** — `vercel --prod` from this worktree picks up Phase 4 (streaming, message
   actions, palette, export, connector auto-routing, the session-race fix). Needs Tarun's auth.
2. **Side-panel buttons** — still the only unverified UI (Chrome side panel is browser chrome;
   needs a human or Cowork click of Compile / Open branch chat).
3. **Enable cookie signing in prod**: `vercel env add SESSION_SECRET` (long random string) —
   the code ships signed-session + rate limiting now (wave 2); unset = unsigned demo mode.
4. Then: `pnpm publish @bonsai/engine`, MCP Apps tree UI, connector OAuth.

**Session 2026-08-18 — Phase 4: app usability (see BUILDLOG for detail; 10 commits, 192 tests,
15/15 evals, CI GREEN — it had been red since 08-12, root cause plugin/mcp deps never installed
in CI; fixed):**
- Regenerate + edit-and-rerun (`/api/message`, engine `truncateForRerun`, real row deletes on
  truncation), rename/archive from the UI (`/api/node`).
- Streaming chat end-to-end: `POST /api/chat/stream` SSE, native Anthropic streaming + mock
  paced stream, escalation `restart` events, client-abort → provider-fetch cancellation,
  buffered fallback. Verified in Chromium against a real model.
- ⌘K palette (search all branches/messages/insights + quick actions), `GET /api/export`
  (garden/subtree, md/json).
- Connector fork: model/effort optional — engine classifier + community prior route it;
  divergence hints returned. Extension icons shipped (`extension/make-icons.mjs`).
- Fixed a real first-visit bug: state/economics session-cookie race (economics no longer mints).
- Run the FULL CI sequence locally before pushing (Tarun asked — no more failure emails):
  typecheck, extension tsc+build+dist-diff, `npm ci --prefix plugin/mcp` + smoke + build +
  dist-diff, tests, evals, build, engine tsup smoke.

