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

Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel. Inference goes through `lib/provider.ts` — set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `XAI_API_KEY` and it is live; set none and a grounded mock with realistic token math takes over, so the app runs with zero configuration. A configured provider failure is explicit and never masquerades as mock success. Local development uses the manifest-last file backend in `BONSAI_DATA_DIR` (default `.bonsai`); Vercel or an explicit KV selection uses configured Neon or Upstash storage and never falls back on failure. Tests and the supported non-production root-only fixture workflow use memory, which can also be selected explicitly in non-production with `BONSAI_PERSISTENCE_BACKEND=memory`.

`lib/persistence/restart.test.ts` launches two independent Node processes against one temporary file store. The first creates a second root tree, chats, branches, merges and archives, creates a nested branch, and reads state, persistence, and economics. The second reloads the exact accepted snapshot, chats on the nested branch, and rereads it. The contract locks immutable briefs and evidence references, tree depth and archive state, exact inference-purpose order and sequence continuation, manual routing, fixture preservation, and ready durable revisions 5 then 6.

## Regenerate the demo fixture

Run `npm run fixture:serve`, then run `npm run fixture:build` in a second terminal. The first
command is a non-production, root-only, memory-only startup; production ignores its fixture flag,
and the generator never requires hand-editing `fixtures/seed-tree.json`.
