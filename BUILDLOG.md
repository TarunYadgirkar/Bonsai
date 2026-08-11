# BUILDLOG — lane A

Running log of what landed, decisions made, and facts verified. Newest first. One entry per
work segment; PLAN.md holds the forward plan, this holds the record.

## 2026-08-11 — Segment 6: the Claude Code plugin (primary surface, working)

- `plugin/` + repo-root marketplace.json: skills `bonsai:branch` (the loop: Claude compiles the
  brief under the skill's referent-resolution contract — the reasoning rides the user's
  subscription; `bonsai_fork` registers + routes; tier-mapped subagent executes; `bonsai_merge`
  records the one-insight return) and `bonsai:tree`; agents `bonsai-branch-{quick,thoughtful,
  deep}` (Haiku/Sonnet/Opus executors with the INSIGHT-line contract); stdio MCP server
  (`plugin/mcp/server.mjs`, @modelcontextprotocol/sdk 1.30) persisting trees per-cwd to
  `CLAUDE_PLUGIN_DATA` with deterministic routing/coverage/economics mirrored from the engine.
  Server smoke: 12/12.
- **End-to-end verified headless** (`claude -p --plugin-dir`): real run compiled a brief,
  forked, spawned the quick-tier branch, the branch honestly PUNTED on an under-specified
  brief, the skill widened by re-forking with more facts, answered, merged one distilled
  insight, rendered the tree — 97.6% pruned on the merged edge. The whole loop, subscription
  auth, zero API keys.
- Security review of segment 4 (security-reviewer): no HIGH/CRITICAL; applied its two LOW fixes
  (timing-safe reset-token compare, 40-turn cap on the distill prompt).

## 2026-08-11 — Segment 5: eval harness (the moat, measured)

- `evals/` runs the engine in-process against scenario cases: referent resolution at depth 1
  (two scenarios, one sharing zero vocabulary with the demo fixture), the **depth-2 proof**
  (fork → sub-conversation that never names the entity → fork again asking "when is the
  deadline?" — only brief composition can resolve it, and it does), routing thresholds
  (lookup→quick, ranking→deep), coverage flagging (uncovered question → covered:false), and
  merge distillation (one line, ≤20 words, referents resolved). 7/7 in mock mode.
- `npm run eval` exits nonzero on failure. GitHub Actions CI added: typecheck + tests + evals +
  build on every push to main/copy-a/copy-b. Same assertions grade live compiler output when a
  key is present — entity-presence checks hold for mock and live alike.

## 2026-08-11 — Segment 4: relational persistence + hardened API boundary

- One-blob `store_snapshot` replaced by relational rows (conversations / messages / insights /
  inference_logs) — schema in `migrations/001_relational_store.sql`, applied to the lane's Neon
  branch (`br-old-fog-avfznwqu`). `lib/store.ts` rewritten as a request-scoped working set:
  load → mutate locally → `commit()` flushes only the delta. Kills the race class: per-row
  writes (no cross-branch clobber), random ids via `newId` (no seq-counter collisions), message
  seq conflicts retry past each other instead of overwriting, no globalThis swap mid-request.
  Memory backend (keyless dev) unchanged in behavior; fixtures seed an empty database.
- **Restart-survival test passed live**: branch created → server killed → restarted → branch
  reloaded from Neon with brief + messages intact. The kv.ts silent-degrade trap is gone —
  `commit()` reports failure and mutating routes return 503 instead of a lying 200.
- API boundary: zod schemas on every mutating route (malformed JSON → 400, oversized/wrong
  fields → field-named 400s), one `apiRoute` wrapper catching everything as ApiError JSON.
  `/api/reset` gateable via BONSAI_RESET_TOKEN (unset keeps open demo behavior). Stray DTOs
  moved into `lib/types.ts`.
- Deleted: `lib/kv.ts` (both backends), `lib/inference-log.ts` local JSON mirror — logs live in
  the database now. Upstash alternate path retired with it.

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
