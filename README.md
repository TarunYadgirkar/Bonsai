# Bonsai

**Grow conversations as trees. Prune context automatically.**

Bonsai replaces the linear chat log with a tree: branch off side questions with a *compiled minimal context* instead of the full history, route each request to the right model + reasoning effort automatically (with manual override), and cherry-pick durable insights back into the parent.

Linear chat forces premature commitment. You ask one thing, the thread goes one way, and exploring the alternative means losing what you had. Bonsai makes the alternative a branch.

## Status

Originally a one-day hackathon build; now being rebuilt into something people can actually use. The Next.js app in this repo is the reference implementation and hosted demo — the surface Bonsai ships on (browser extension, CLI plugin, something else) is an open question being explored on the `copy-a` and `copy-b` branches.

## Repo map

| Path | What it is |
|---|---|
| `PRODUCT.md` | The product idea. The "why." |
| `AGENTS.md` | Rules and conventions for coding agents. Source of truth. |
| `lib/` | The engine — tree store, context compiler, router, providers. |
| `app/` | Next.js App Router pages and API routes. |
| `components/` | Tree sidebar, chat pane, economics panel. |
| `fixtures/` | Seeded conversation + generated demo tree. |

## Stack

Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel. Inference goes through `lib/provider.ts` — set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `XAI_API_KEY` and it is live; set none and a mock with realistic token math takes over, so the app runs with zero configuration. Store persistence is Neon Postgres via `lib/kv.ts`; durable memory is EverMind EverOS via `lib/memory.ts`. Every external dependency degrades to a working local path when its key is absent.
