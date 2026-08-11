# BUILDLOG — lane A

Running log of what landed, decisions made, and facts verified. Newest first. One entry per
work segment; PLAN.md holds the forward plan, this holds the record.

## 2026-08-11 — Segment 1: engine extracted to `@bonsai/engine`

- npm workspaces; `packages/engine` holds types, tokens, models, llm (provider→mock chain,
  `CompleteFn` seam), provider, compiler, router, tree (pure functions over `Conversation[]`).
- Compiler and router now take an injectable `{ complete }` — surfaces and tests supply their
  own inference; the built-in chain stays the default so app behavior is unchanged.
- `lib/` keeps the web-app shell: store (globalThis singleton + KV mirror + fixture seeding),
  kv, accounting (`buildLog`, ex-mock.ts), inference-log, types (HTTP DTOs + re-exports).
- Dead M0 stubs deleted with `lib/mock.ts`; `mockInsight` fixture text replaced by a neutral
  fallback in the merge route. Vitest suite locks current engine behavior before segment 2
  rewrites semantics.

Distribution note: skillrank.dev (BuildBetter's skills registry / `skillrank search`) is a
candidate channel for the plugin alongside the marketplace repo.

## 2026-08-11 — Surface research (5-agent sweep)

Decision recorded in PLAN.md (plugin primary, connector fast-follow, extension cut). Key
verified facts that gate later segments:

- **Pricing (platform.claude.com, 2026-08-10):** Haiku 4.5 $1/$5 · Sonnet 5 intro $2/$10 until
  2026-08-31 then $3/$15 · Opus 5 $5/$25 · Fable 5 $10/$50 per MTok. Cache read 0.1x. The
  current `models.ts` table overstates Opus/Fable ~3x — fix in segment 3, store pricing as
  dated records.
- **Param rules (4.7+/5 Claude models):** never send temperature/top_p/top_k (400). Effort is
  `output_config.effort` (low…max) on Sonnet 5/Opus 5/Fable 5 — NOT Haiku 4.5 (errors; Haiku
  uses old `thinking.budget_tokens`). Fable 5: thinking always on, 30-day-retention orgs only,
  can return stop_reason `refusal`. `max_tokens` caps thinking+text combined. Assistant prefill
  400s on all 4.6+.
- **Prompt-cache interplay:** resolved effort is rendered into the prompt — changing effort per
  turn invalidates the cache. Route effort at fork time (per branch), not per message. This
  aligns with Bonsai's pin-per-branch design and is now a segment 2 requirement.
- **Tokenizer:** 4.7+/5 models tokenize ~1.3x heavier than Haiku 4.5. `count_tokens` endpoint
  is free with a separate RPM bucket. Best offline estimator: bpe-lite (±10%); chars/4 stays
  for UI-only counters.
- **Claude Code plugin capabilities:** agent frontmatter carries model/effort/tools/memory/
  isolation; plugins bundle skills+agents+hooks+MCP servers; SubagentStop prompt-hooks run on
  the user's subscription; `${CLAUDE_PLUGIN_DATA}` persists state; marketplace = GitHub repo.
- **Competitive:** compiled-brief fork + distilled merge-back + per-branch routing is unclaimed
  by any shipped product (ChatGPT/Gemini/LibreChat/Msty/TypingMind = full-copy, no merge;
  Forky/Tangent = experiments; ContextTree = manual retrieval). Academic validation exists
  (Branchat CHI 2026; arXiv 2603.21278).

## 2026-08-11 — Segment 0

tsx/vitest/typecheck declared; PLAN.md added. Deep-read of the whole repo (6-agent workflow)
established the three load-bearing gaps: merge never re-enters context, compile is depth-1
(not path-based), live provider 400s on every rung above Haiku. Vercel prod healthy on `main`.
