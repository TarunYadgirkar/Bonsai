# Contributing to Bonsai

Bonsai is tree-structured AI chat: fork a side question with a *compiled minimal context brief*
instead of the full transcript, route each branch to a model + reasoning effort automatically, and
merge exactly one distilled insight back. Read [`PRODUCT.md`](PRODUCT.md) for the idea before
diving in.

The durable value is the engine — the tree model, path-based brief compilation, coverage-aware
routing, and the merge-back contract. Surfaces are thin. **Prefer changes that strengthen that
core over changes that only decorate one surface.**

## Repo layout

| Path | What it is |
|---|---|
| `packages/engine/` | `@bonsai/engine` — the core: tree model, path assembly, brief compiler, router, learning router, providers. Zero runtime deps. See its [README](packages/engine/README.md). |
| `app/` · `components/` · `lib/` | Next.js (App Router) demo + engine testbed: API routes over the engine, tree sidebar, chat pane. Includes the remote MCP connector at `app/api/mcp/` ([README](app/api/mcp/README.md)). |
| `plugin/` | Claude Code plugin — the full loop on your Claude subscription (skills, tier agents, bundled stdio MCP tree server). |
| `extension/` | MV3 Chrome extension over claude.ai — reads + pre-fills, strictly human-in-the-loop. |
| `evals/` | Eval harness (`npm run eval`) — referent resolution, routing thresholds, distillation, learning. |
| `migrations/` | Relational schema for the Neon store (`001` store, `002` routing profile, `003` MCP connector). |

## Running it

Everything runs with **zero keys** — every external dependency degrades to a working local path
(extractive mock inference, in-memory store) when its env var is absent.

```bash
npm install
npm run dev          # Next.js dev server
npm run test         # engine unit tests (vitest)
npm run typecheck    # tsc --noEmit (root)
npm run eval         # engine evals (mock mode; live grading with a provider key)
node extension/build.mjs   # bundle the Chrome extension (esbuild) → extension/dist/
```

Optional keys (names in `.env.example`): `DATABASE_URL` (Neon) for durable storage; one of
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `XAI_API_KEY` for live inference. Secrets go only in
`.env.local`, never in the repo.

## The CI gate

`.github/workflows/ci.yml` runs on every push to `main`/`copy-a`/`copy-b` and every PR. It must be
green before merge. In order:

```
npm run typecheck                                # root
npx tsc --noEmit --project extension/tsconfig.json   # extension (own chrome-typed tsconfig)
node extension/build.mjs                          # extension build
npm run test                                      # engine unit tests
npm run eval                                      # evals (mock; no keys in CI)
npm run build                                     # Next.js build
```

Run these locally before opening a PR. Fix every error — don't skip a step.

## Commit style

- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, etc., with a short imperative
  subject.
- **No `Co-Authored-By:` trailers, no generated-with footers, no bulleted change lists.** A body
  only when the *why* is non-obvious.
- No refactors outside the current task.

## The principle to hold

**Surfaces ride subscriptions; the extension is human-in-the-loop.** The product bet is riding the
Claude session you already pay for, not a standalone bring-your-own-key app. On the plugin and the
MCP connector, Claude does the inference in-conversation. The Chrome extension **reads and
pre-fills only — it never sends a message or calls a model on your behalf.** That constraint is
structural (there is no POST/send code in the extension bundle), because auto-sending through a
consumer session is what Anthropic's terms forbid. Keep it that way.

## More

- [`AGENTS.md`](AGENTS.md) — rules and conventions for coding agents (the source of truth for
  working in this repo, including the Neon-branch-per-git-branch layout and known traps).
- [`DESIGN.md`](DESIGN.md) — the design system for the web surface.
