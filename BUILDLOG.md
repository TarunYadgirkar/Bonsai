# BUILDLOG — lane A

Running log of what landed, decisions made, and facts verified. Newest first. One entry per
work segment; PLAN.md holds the forward plan, this holds the record.

## 2026-08-11 — Remote MCP connector for claude.ai (subscription-riding surface #3)

`app/api/mcp/[key]/route.ts` — a claude.ai custom connector (mcp-handler 2.1.0, Streamable HTTP)
so claude.ai Pro/Max users get the Bonsai loop on their subscription. No LLM calls (MCP sampling
is unsupported): Claude compiles the brief in-conversation and passes it as a tool argument; the
connector stores tree state (Neon `mcp_nodes`, `migrations/003`) and formats. Tools: `bonsai_fork`
(returns a paste-ready brief block + routing + economics), `bonsai_merge` (one distilled insight,
≤30 words), `bonsai_abandon`, `bonsai_tree` (unicode tree in text + `structuredContent` so a
future MCP Apps UI slots in free). Auth v1: garden-key path segment validated against `mcp_users`,
`Authorization: Bearer` accepted too (static-headers-beta ready); unknown key → 401.
**Smoke: 18/18 against live Neon** — fork/tree/merge persisted, root session node auto-created,
unknown key rejected. MCP Apps tree UI deferred to v2 (draft spec; and the iframe can't spawn new
chats — that's the extension's job).

Toolchain: extension excluded from the root `tsc` gate (it has its own `chrome`-typed tsconfig +
typecheck); CI now runs the extension typecheck + build too. `@types/chrome` at root.

## 2026-08-11 — Chrome extension for claude.ai (subscription-riding surface #2)

`extension/` — MV3, side panel + thin content script, engine bundled via esbuild (39kb). The
full loop on the user's claude.ai subscription, **strictly human-in-the-loop**: reads the
conversation (same-origin GET, cookie auth — dodges Cloudflare), compiles a minimal brief
LOCALLY with the extractive engine (zero model calls), recommends model+effort (local learning
router; changing the pick teaches it), pre-fills a new-chat composer with the brief, and
pre-fills the parent chat with the merged insight. **It never sends** — enforced structurally:
`claude-api.ts` exposes only a GET helper with an allowlisted path prefix; no POST/send/
completion code exists in the bundle.

**Verified live against real claude.ai (nothing sent):** org id from `lastActiveOrg` cookie +
conversation list (245 convs), `?tree=true` endpoint + `reconstructPath` rebuilding the
on-screen path (6-msg thread, leaf pointer, content blocks — matches the 4 unit tests), and the
multi-line brief pre-filling the ProseMirror composer then clearing cleanly. Finding:
`execCommand('insertText')`, synthetic paste, and `beforeinput` all no-op on the current
ProseMirror build — the working method is `<p>`-per-line `replaceChildren` + `input` event, now
shipped. Cross-conversation tree + learned profile in `chrome.storage.local`.

## 2026-08-11 — Learning router (the pitched differentiator, now real)

The one feature the deck sold that the rebuild had stripped (was the EverOS sponsor integration):
the router that **learns**. `packages/engine/src/learning.ts` — a transparent, explainable
per-user profile:
- Signals, all already logged, all real behavior: override (manual pick moved off the branch's
  last auto tier), escalation (cheap answer failed → started too low), merge (answer kept → tier
  sufficient), abandon (weak, confidence-only).
- Once ≥3 directional samples agree ≥60% on a classified tier, the router pre-empts the
  classifier and shifts that tier, with a one-sentence reason ("You've upgraded quick picks 7/7
  times, so this one starts at thoughtful").
- Wired into `route()` (auto path only, after classification); chat/branch/merge routes emit
  feedback; profile persisted to Neon (`routing_profiles`, `migrations/002`) with memory
  fallback. **Verified live**: 3 manual upgrades → an auto lookup shifted quick→Sonnet 5 with
  the learned explanation, persisted across the request.
- Also fixed a real bug found in testing: an explicit "auto" pick now unpins the branch THIS
  turn (route() was reading a stale pre-update `pinnedMode`).
- Coverage: 15 new unit tests + an eval case (cold=quick → warm=thoughtful, learned=true). 114
  tests, 8/8 evals.

## 2026-08-11 — Segment 7: web demo truth pass + docs made honest

- UI: after-load errors now visible (dismissible banner) and a failed send restores the draft
  instead of destroying it; mode pins are server-truth (survive reload via
  `conversation.pinnedMode`); assistant messages render markdown (react-markdown, HTML stays
  escaped); merged insights shown as a collapsible "Learned from branches" strip (they
  genuinely enter model context now); RoutingChip hover shows "widened" / "brief flagged
  insufficient" truth badges and no longer caches a failed catalog fetch forever; economics
  baseline explicitly labeled a modeled counterfactual.
- Docs: PRODUCT.md rewritten as spec + honest roadmap (fictional learning-router/memory claims
  moved to "not built yet"; positioning: the loop, not the tree). README reflects the real
  layout. AGENTS.md stack/traps updated (engine package, relational store, plugin, param
  rules, effort-per-branch cache rule). Every dangling DEMO.md/"Beat" comment swept.

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
