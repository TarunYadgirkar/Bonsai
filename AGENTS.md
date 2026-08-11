# AGENTS.md — rules for coding agents in this repo

> **This checkout is the `copy-b` lane. Read `LANE.md` first — it is your mission brief.**

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
- Inference: `lib/provider.ts`. One of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` makes it live; none means the mock in `lib/llm.ts`.
- Store persistence: Neon Postgres via `lib/kv.ts`, table `store_snapshot`.

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

Every external dependency sits behind an interface with a mock that activates automatically when its env vars are missing. `lib/llm.ts` returns canned-but-realistic responses with real token math; `lib/kv.ts` falls back to in-memory. The app must fully run with zero keys configured.

**`lib/kv.ts` swallows errors by design.** A wrong `DATABASE_URL` degrades to in-memory *silently* and looks identical to no config. Confirm persistence with a restart-survival test, never by assuming.

## Working rules

1. Build clean before committing: `npm run build`. Fix every error.
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

## Ongoing

Updated: 2026-08-10

**Done this session:**
- History rewritten so every commit is authored by Tarun Yadgirkar; all `Co-Authored-By: Claude` trailers stripped.
- Repo is private. Branch layout above created.
- The dead sponsor integration was removed (`98e91d0`) — barred on the trial account and inert behind an unset flag, so it was entirely dead code. Do not reintroduce it. The local JSON log writer it contained survives as `lib/inference-log.ts`; the integration itself remains only in `hackathon-copy`.
- Vercel restricted to deploying `main` (`b3ddd26`).
- New Neon project `bonsai` (`wild-feather-67393800`) with per-lane branches.
- Hackathon-only docs (`PLAN.md`, `PROMPTS.md`, `DEMO.md`, `docs/`) deleted here; they remain in `hackathon-copy`.
- The durable-memory sponsor integration removed along with its types (`ContextBrief.memoryIds`, `Insight.memoryId`) and the "· durable memory" tag.

**Open:**
- Surface direction undecided — extension vs CLI plugin vs something else. `copy-a` and `copy-b` exist to explore it.
- Provider strategy unresolved. The goal is to draw on a user's existing monthly subscription rather than requiring an API key, which pulls toward surfaces that ride an already-authenticated session.
- Whether Bonsai needs durable cross-conversation memory, and what should provide it, is undecided.
- `PRODUCT.md` still carries the hackathon framing and needs a rewrite.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
