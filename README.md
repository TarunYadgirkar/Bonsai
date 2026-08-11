# Bonsai

**Branch the thought, not the transcript.**

Tree-structured AI conversation: fork side questions with a *compiled minimal context brief*
instead of the full history, auto-route each branch to the right model + reasoning effort,
and merge exactly one distilled insight back into the parent. Read `PRODUCT.md` for the why.

## Status

Post-hackathon rebuild, active. The engine is a standalone package with unit tests and an eval
harness proving referent resolution through composed briefs; the primary surface is a Claude
Code plugin that runs the whole loop on your existing Claude subscription. The Next.js app is
the hosted demo and engine testbed.

## Repo map

| Path | What it is |
|---|---|
| `PRODUCT.md` | The idea, what exists, and the honest roadmap. |
| `AGENTS.md` | Rules and conventions for coding agents. Source of truth. |
| `packages/engine/` | `@bonsai/engine` — tree model, path assembly, brief compiler, router, providers. Zero runtime deps. |
| `plugin/` | Claude Code plugin: branch/tree skills, tier agents, bundled MCP tree server. |
| `evals/` | Eval harness (`npm run eval`) — referent resolution, routing, distillation. |
| `app/` · `components/` | Next.js demo: API routes over the engine, tree sidebar, chat pane, economics panel. |
| `migrations/` | Relational schema for the Neon store. |

## Run it

```
npm install
npm run dev        # zero keys: extractive mock inference, in-memory store
npm run test       # engine unit tests
npm run eval       # engine evals (mock mode; live grading with a provider key)
```

Set `DATABASE_URL` (Neon) for durable storage — schema in `migrations/`. Set one of
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` for live inference; every dependency
degrades to a working local path when its key is absent.

## Plugin

```
/plugin marketplace add TarunYadgirkar/Bonsai
/plugin install bonsai@bonsai
```

Then: "branch this: <side question>" in any Claude Code session. See `plugin/README.md`.
