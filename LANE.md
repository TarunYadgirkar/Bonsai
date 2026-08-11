# LANE.md — copy-b

You own the `copy-b` branch. Worktree `~/TarunsCode/bonsai-copy-b`, its own Neon database branch
already wired in `.env.local`. A parallel agent owns `copy-a` — no coordination, no copying, no
merging between lanes. Tarun compares the lanes and decides what reaches `main`.

## Mission

Turn Bonsai from a hackathon demo into something big, real, and open-sourceable — a project worth
using in interviews and cold outreach. The hackathon constraints are gone.

**Direction, architecture, tooling, order of work — all yours.** Pick the surface you believe in,
decide what the engine needs, use whatever connections, tools, or workflows you judge right. This
file gives context, not instructions.

## What Bonsai is

Tree-structured AI chat. Branch a side question off a parent conversation with a *compiled minimal
context brief* instead of the full history; auto-route each request to model + effort; merge one
distilled insight back to the parent. Pitch: "the cheapest token is the one you don't send."

## Context worth having (Tarun's current thinking, not orders)

- He sees the durable value in the layer under the UI: the tree model and how context is assembled
  from a path through it — what gets sent on fork, what gets pruned, how branches merge back.
- He considers the standalone web app dead as a product bet; the Next.js app here survives as
  hosted demo and testbed. Surfaces he's discussed: browser extension over claude.ai/chatgpt.com,
  CLI/coding-agent plugin. MCP came up and was doubted. None of this is binding on you.
- He wants Bonsai to eventually draw on a user's existing chat subscription rather than requiring
  an API key. BYOK works today via `lib/provider.ts` but is not the end state he wants.
- He's fine with the idea being shipped natively by the big labs someday — the artifact and the
  story carry value regardless.

## Current state

- Engine in `lib/`: `store.ts` (tree), `compiler.ts` (context briefs), `router.ts`
  (classify + escalate), `provider.ts` (Anthropic/OpenAI/xAI or mock), `kv.ts` (Neon).
- Both hackathon sponsor integrations were removed. There is deliberately no durable-memory
  layer; adding one back is a decision, not a default.
- UI: node-graph sidebar, chat pane, model×effort chips, economics panel, URL navigation.

## Hard boundaries

Never touch `main`, `og`, `hackathon-copy`, or the other lane · never repoint `DATABASE_URL` ·
build clean before committing · commit subjects short and conventional, no trailers ·
`.env*` is hook-blocked, hand Tarun commands instead · `lib/kv.ts` fails silently — prove
persistence with a restart test, never assume. Everything else in `AGENTS.md` applies.
