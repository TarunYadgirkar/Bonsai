# LANE.md — copy-a (Claude Code lane)

You are the agent for the `copy-a` branch. Worktree `~/TarunsCode/bonsai-copy-a`, your own Neon
database branch (already wired in `.env.local` — never change `DATABASE_URL` to another lane's).
A parallel Codex agent runs the `copy-b` lane; you do not coordinate with it, copy from it, or
merge into it. Tarun compares the lanes and decides what reaches `main`.

## Mission

Turn Bonsai from a hackathon demo into something real people can use — open source, credible in
interviews, worth cold-emailing about. The hackathon constraints (sponsors, demo script, judged
beats) are gone. You have full direction freedom on this branch.

## What Bonsai is

Tree-structured AI chat. Branch a side question off a parent conversation with a *compiled minimal
context brief* instead of the full history; auto-route each request to model + effort; merge one
distilled insight back to the parent. Pitch: "the cheapest token is the one you don't send."

## Context from the direction discussion (2026-08-10)

- **The core is the product, not the UI.** The tree data model + how context is assembled from a
  path through it (what gets sent on fork, what gets pruned, how branches merge) is the durable,
  defensible layer. Surfaces are thin once it's right. Strengthen the core first.
- **Standalone web app is dead as a product bet.** The Next.js app survives as hosted demo and
  engine testbed only.
- Candidate surfaces: **Chrome extension over claude.ai/chatgpt.com** (highest distribution,
  fragile DOM) and **Claude Code / CLI plugin** (real pain, specifiable). MCP was judged weak — a
  tree is client-side state the host UI won't render.
- **Key constraint:** Tarun wants Bonsai to draw on a user's existing monthly subscription
  (claude.ai / ChatGPT plan) rather than requiring an API key. That favors surfaces riding an
  already-authenticated session. BYOK is the fallback, not the goal.
- It is fine if Anthropic/OpenAI ship the idea natively — the artifact and the story are the value.

## Current state of the code

- Engine: `lib/store.ts` (tree), `lib/compiler.ts` (brief compilation), `lib/router.ts`
  (classify + escalate), `lib/provider.ts` (Anthropic/OpenAI/xAI or mock), `lib/kv.ts` (Neon).
- Both hackathon sponsor integrations are removed. There is deliberately **no durable-memory
  layer**; do not add one without a reason written down first.
- UI: node-graph sidebar, chat pane, model×effort chips, economics panel, URL-backed navigation.

## Suggested first moves (yours to override)

1. Read `AGENTS.md` (rules) and skim `lib/` — especially `compiler.ts` and `store.ts`.
2. Write `DIRECTION.md`: the surface you're betting on, why, and what the core engine needs that
   it doesn't have (streaming? multi-root trees? context assembly as a standalone package?).
3. Extract the engine's seams: the tree + compiler currently assume the Next store. If your
   direction is an extension or plugin, the first real milestone is the core as a
   dependency-free TypeScript package the surface can import.
4. Build. Commit small, push to `origin/copy-a` often.

## Rules that survive from AGENTS.md

`npm run build` clean before every commit · commit subjects short, conventional, no trailers ·
never touch `main`, `og`, `hackathon-copy`, or the other lane · `.env*` is hook-blocked, hand
Tarun commands instead · `lib/kv.ts` fails silently — prove persistence with a restart test.
