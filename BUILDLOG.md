# BUILDLOG — lane A

Running log of what landed, decisions made, and facts verified. Newest first. One entry per
work segment; PLAN.md holds the forward plan, this holds the record.

## 2026-08-11 — Segment 3: live provider fixed, accounting honest

- `provider.ts` rebuilt on per-model capability records: sampling params only on Haiku 4.5
  (they 400 on the 5-family — this was silently mocking 3 of 4 rungs whenever a real key was
  set); reasoning effort now maps onto the real `output_config.effort`; `max_tokens` raised to
  an effort-keyed total on adaptive-thinking models (the cap covers thinking + text); Fable 5
  `stop_reason: "refusal"` degrades to mock instead of surfacing half-answers; per-effort
  timeouts (30s low → 120s max); AbortSignal pass-through. Request body building is exported
  (`anthropicBody`) and tested as the param-policy contract.
- Pricing corrected to verified rates (Opus 5 $5/$25, Fable 5 $10/$50 — the old table
  overstated the headline savings ~3x). Non-Anthropic upstreams priced at their own rates via
  `costForServedBy` (a gpt-5.5 answer no longer bills at Opus rates). OpenAI/xAI rungs updated
  to current ids (gpt-5.4-mini/5.4/5.5, grok-4.3/4.5) with real ladder separation.
- Streaming deliberately deferred until a surface consumes it (plugin uses the Agent SDK's own
  streaming; web app is whole-response today).

## 2026-08-11 — Segment 2: engine semantics made true

The three headline gaps closed:

- **Path-based assembly** (`engine/src/context.ts`): compile input for a fork = parent's brief
  (+ its merged insights) + transcript up to the fork anchor. Briefs compose recursively, so
  referents resolved at depth N stay resolved at depth N+1 — verified live: a depth-2 branch's
  facts carry the parent brief's resolved referents. Forks are anchored
  (`ContextBrief.anchorMessageId`); messages after the anchor are out of scope.
- **Merge loop closed**: `renderChatContext` puts a conversation's insights into every answer
  prompt ("Learned from branches"), and `assemblePath` carries them into sibling compiles.
  Merge output now reaches models, not just the sidebar.
- **Context-first escalation** (`router.ts` rewrite): classifier now reads the brief's facts and
  returns `covered`; uncovered questions pre-widen (pull parent turns in) before the first
  answer. Punts retry once on the SAME model with widened context before any model upgrade.
  Manual picks and pins are never silently upgraded. Terse answers to complexity-1 lookups no
  longer trigger paid escalation.
- Supporting: brief token budget (800 default, tail-trim), `prunedPct` floored at 0, compile
  calls return real usage (fabricated compile log rows gone), typed `purpose` on CompleteParams
  (mock dispatches on intent, not prompt-sniffing), branch-level `pinnedMode` persisted
  server-side (chat with manual mode pins the branch; auto unpins — also keeps provider prompt
  cache warm per the effort/cache finding).
- Suite: 93 tests green, incl. new context.test.ts. Test agent caught a real bug (mock
  classifier read the wrong facts header — zero-key mode could never report uncovered); fixed.
- Segment-1 extraction review (typescript-reviewer): approve, no HIGH/CRITICAL; one intentional
  MEDIUM (engine package ships TS source via `exports` — revisit when publishing standalone).

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
