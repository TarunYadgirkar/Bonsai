# AGENTS.md — rules for coding agents in this repo

## What this is

Bonsai: tree-structured AI chat. Branch side questions off a parent conversation with a *compiled minimal context brief* instead of full history; auto-route each request to a model + effort tier (⚡ quick / 🧠 thoughtful / 🔬 deep) with manual override; cherry-pick insights back into the parent. Read `PRODUCT.md` for the idea, `DEMO.md` for what must work, `PLAN.md` for what to build right now.

**Priority order for every decision: does it make DEMO.md work → is it in the current milestone → everything else. This is a one-day hackathon build; demo-correct beats architecture-correct.**

## Stack

- Next.js (latest, App Router) + TypeScript + Tailwind. Deployed on Vercel; `main` auto-deploys.
- Model calls: Snowflake Cortex `AI_COMPLETE` via REST (`docs/snowflake-notes.md`). Durable memory: EverMind EverOS v1 API (`docs/evermind-notes.md`).
- No databases to stand up. Logs/memory fall back to JSON files under `data/` (gitignored) when remote services are absent.

## Territories — hard boundary, two agents work in parallel

- **Person A's agent:** `app/**` pages/layouts, `components/**`. Consumes the API routes only.
- **Person B's agent:** `lib/**`, `app/api/**`, `scripts/**`, `fixtures/**`.
- Shared, frozen after M0: `lib/types.ts` and the API route signatures. Changing a contract requires the humans agreeing out loud first; then one agent makes the change in a single commit.
- Never edit files in the other territory. If you need something from it, say so and stop.

## Mock-first rule

Every external dependency sits behind an interface with a mock mode that activates automatically when its env vars are missing:
- `lib/llm.ts` → mock returns canned but realistic responses WITH realistic token counts/costs.
- `lib/memory.ts` → falls back to `data/memory.json`.
- Inference logging → `data/inference-log.json` unless the Snowflake table is already working.
The app must fully run, and the DEMO.md script must be walkable, with zero keys configured.

## Working rules

1. One milestone per session/prompt. Read `PLAN.md` for scope; do not work ahead.
2. After each milestone: `npm run build`, fix every error, then commit with the message given in PROMPTS.md. Small commits, straight to `main`, pull before push.
3. No refactors outside the current task. No renaming, no "cleanup," no dependency swaps.
4. Keep it boring: fetch + JSON, plain React state (or a single zustand store), no exotic libraries. Tree UI may use `reactflow`; an indented list is an acceptable fallback.
5. `fixtures/seed-conversation.json` is the demo's foundation. Don't rewrite it; you may append messages to make it longer/richer if asked. If it changes, re-verify the two demo questions still resolve.
6. Secrets: only via env (`.env.local`, never committed). `.env.example` lists the names. Never print keys.
7. Model discipline: default all internal calls (classifier, compiler, merge-distiller) to the **cheapest** available model; only the deep tier uses a strong model. We are literally demoing cost discipline.
8. Errors from Snowflake/EverMind: catch, log one line, fall back to mock. The demo never crashes on a 4xx.
9. Don't invent Snowflake/EverMind endpoints or params. If `docs/` doesn't cover it, ask the human — the human has the official docs open.

## Definition of done (any task)

Builds clean · demo script beats it touches still work · committed · nothing outside territory touched.

## Ongoing

Updated: 2026-08-07T11:34:13-0700 by claude session (Person B / engine)

**Done:**
- `24e86f1` M0 contracts — `lib/types.ts` FROZEN. Adds `GET /api/state` (rootId + tree + conversations in one call) beyond PLAN.md's four routes.
- `6f66832` M0 stubs — `lib/store.ts` (fixture-seeded, on `globalThis`), `lib/tokens.ts`, `lib/models.ts`, `lib/mock.ts`, all five routes.
- `f3f4fca` repo flattened (was a nested `bonsai/` subdir), `.gitignore` + `.env.example` added.
- `5ebf6d4` fixture grown 16 → 72 messages, **19,013 available tokens** so DEMO.md Beat 1's "19,000" is literally true. Original 16 messages untouched.
- `1bdce9c` / `d9936b1` / `4ef7995` EverOS **v2** memory layer, wired into `/api/merge` (write) and `/api/branch` (recall).
- `467a174` EverOS round trip **verified live on Vercel prod** — merge wrote an insight, a branch ~8s later recalled it as a real extracted episode.
- `ab67242` M1+M2 engine — `lib/llm.ts` (Cortex), `lib/compiler.ts` (compileBrief), `lib/router.ts` (classifier + escalation), `scripts/try-engine.ts`. Routes now use the engine, merge distills a real insight.
- Vercel project `bonsai` created and GitHub-connected; `main` auto-deploys. Live: **https://bonsai-lac.vercel.app** (the `bonsai-<hash>` preview URLs are 302-protected; the canonical alias is public). `EVERMIND_API_KEY` set encrypted on Production + Preview + Development.

**Live numbers from the real pipeline (mock LLM mode, real EverOS):**
`19,013 avail → 282 brief → 98.5% pruned → ⚡ quick / $0.0004` · deep question → `🔬 deep / $0.0175` · session totals `$0.0668 vs $2.0686 baseline = 96.8% cost saved`.

**Blocked:**
- **Snowflake creds absent.** `SNOWFLAKE_ACCOUNT_URL` / `SNOWFLAKE_PAT` are blank, so `lib/llm.ts` runs mock mode. Everything is behind the interface — dropping the two env vars in is the whole integration, no code change. Tarun is getting them.
- **`MODEL_TIERS` in `lib/models.ts` are unverified** — `claude-haiku` / `claude-sonnet` / `claude-opus`, chosen because the names read clearly on stage. Confirm they exist in this Cortex account/region before trusting a live call; AGENTS.md rule 9 applies.
- Agents cannot write or read `.env*` here — two `PreToolUse` hooks block it, and `--dangerously-skip-permissions` does not bypass hooks. Hand Tarun the command; he runs it.

**Next (Person B, ordered):**
1. **Store persistence — highest risk, do first.** `lib/store.ts` keeps everything on `globalThis`. Fine on one warm instance; a Vercel cold start mid-demo drops every branch created on stage. `data/*.json` does **not** solve it — Vercel's filesystem is read-only outside `/tmp`. Either demo from localhost, or move to a real KV. Decide explicitly, don't leave it.
2. Drop in the Snowflake env vars when they land, then run `npx tsx --env-file=.env.local scripts/try-engine.ts` and confirm both DEMO.md questions still route ⚡ and 🔬 against real Cortex.
3. Verify the Cortex response parse. `lib/llm.ts` handles both a plain JSON body and an SSE stream because we could not confirm which this account returns — check which one actually comes back and delete the dead path if there's time.
4. Pre-test deep-tier latency. `docs/snowflake-notes.md` warns big models are slow; the deep question must return inside demo patience (~10s) or Beat 3 dies on stage.
5. Optional, only if 1–4 are done: mirror `InferenceLog` rows into a Snowflake table so Beat 5 is literally "queried from Snowflake". Pure stage line, zero product difference — it is cut-line #2 for a reason.

**Do not cut** (DEMO.md): branch + compiled brief with pruned-%, the ⚡/🔬 contrast on the two demo questions, merge-insight, the counters. Note the mock classifier is deliberately heuristic so that contrast survives with zero keys — do not "simplify" it to a constant.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
