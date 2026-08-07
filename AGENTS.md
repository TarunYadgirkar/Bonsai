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
