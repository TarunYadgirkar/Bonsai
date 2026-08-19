# BUILDLOG — lane A

Running log of what landed, decisions made, and facts verified. Newest first. One entry per
work segment; PLAN.md holds the forward plan, this holds the record.

## 2026-08-12 — Adversarial audit → all 36 findings fixed → live-deployed + tested

A 56-agent adversarial review (8 dimensions, verify pass) of the whole copy-a diff surfaced 36
verified bugs. All fixed across five committed batches; gates green throughout (173 tests, 10/10
evals, plugin smoke 12/12, root + extension typecheck, both builds).

- **Per-session gardens** (the user's headline ask): the web app no longer preloads the Berkeley
  fixture for everyone. `lib/session.ts` cookie + `session_id` column (`migrations/004`); a fresh
  visitor lands on an EMPTY root that answers from its own transcript; Berkeley is opt-in via
  `/api/demo` ("Load Berkeley demo"). Store rewritten around this; a memory-fallback working set
  refuses to write back over a DB that only failed to READ (was clobbering real rows).
- **Connector auth fails closed**: rejects the repo-literal `bonsai-dev-key` whenever DATABASE_URL
  is set, rejects (not memory-falls-back) on DB error; sticky degrade → 30s cooldown; per-key node
  cap + parentId ownership check; path key canonical vs bearer; dev-key seed removed from mig 003.
- **Learning router**: feedback attributed to the classifier's PRE-adjustment tier
  (`RoutingDecision.classifiedTier`) so a bad learned shift self-corrects; inherited pins no longer
  re-log an override every turn.
- **Engine**: fork anchors honoured + fail closed on unknown anchor; mock compiler carries the
  inherited brief forward instead of injecting the Berkeley fixture (depth-2 proof now genuine —
  it had been passing on the fixture); non-string facts filtered before the empty-brief gate;
  provider propagates a caller abort; baseline scaled onto the strong model's 1.3x tokenizer;
  `buildLog` persists the engine's real per-attempt cost (escalation + `costForServedBy`).
- **Plugin**: bundled self-contained (`mcp/dist/server.mjs`, install needs no npm); cross-process
  store lock; coverage retry supersedes phantom siblings + abandoned drop out of economics; routed
  effort rendered into the subagent prompt; insight cap 20 everywhere.
- **Extension**: session storage opened to the content script (prefill was a silent no-op);
  fresh-chat link guard; selection-tab guard; orgId UUID validation; per-kind feedback;
  **structural never-send** (esbuild stub — 0 model-POST refs in the bundle); dropped `tabs`
  permission; Branch chip clears the selection on click so it dismisses cleanly.
- **Web UI**: failed-send draft survives a branch switch; routing chip no longer flickers to Auto;
  economics dialog traps focus.
- **Garden artifact** reworked into a real left-to-right tree diagram (same URL b1b44d60).
- Left deliberately (documented in place): connector open CORS/origin (claude.ai initialize breaks
  with strict validation); per-session routing-profile read-modify-write (last-write-wins,
  negligible per-session contention).

**Live-deployed + tested.** Preview deploy of the new code + migrated Neon branch
(`br-small-mode-avqh6i55`) at
https://bonsai-connector-kqdihj0ni-taruns-projects-248def65.vercel.app — production
bonsai-connector.vercel.app UNTOUCHED and verified healthy. Drove a full multi-turn conversation
via Playwright: per-session empty root, routing (open-ended escalates, brief-covered lookup →
Haiku Low), text-select→branch→compiled brief (85%+ pruned)→merge insight to trunk→persists across
reload; economics ledger with the cost fixes visible. Connector fork/merge exercised live on the
claude.ai account. Extension loaded unpacked + verified in the browser: content script injects,
Branch chip appears on selection and (after the fix) dismisses cleanly. **Not verified:** the side
panel's own buttons (Compile / Open branch chat) — Chrome's side panel is browser chrome, not page
DOM, so no automation tool can drive it; needs a human-watched pass. Web deploy runs in MOCK mode
(no ANTHROPIC_API_KEY set) — extractive, not real models; a key makes it BYOK-real.

**Still needs Tarun:** promote to production (migrate the LIVE branch `br-old-fog` — classifier
blocked my DDL there — then `vercel --prod`); optionally add ANTHROPIC_API_KEY to the preview for
real models; finish the manual side-panel smoke of the extension.

## 2026-08-11 — Engine intelligence + moat + OSS A- (advanced-features round)

Driven by "make the advanced stuff insane; explore the moat; A+ open source; recruiter-grade."
Four subagents in file-partitioned waves; I owned the router/learning/moat core by hand.

- **Salience compiler** (`llm.ts` mock + `compiler.ts` live prompt): brief facts now ranked by
  term rarity (inverse sentence-frequency) + recency + speaker role + topic mention, not flat
  keyword count. Differential eval: a rare-term stipend sentence ("Hertz … $55,000") among
  common-word noise — a raw count drops it from the brief; salience ranks it first.
- **Learning router v2** (`learning.ts`, `types.ts`, `router.ts`): PER-QUESTION-KIND priors
  (lookup/synthesis/comparison/reasoning/code/creative/other); classifier emits `kind` +
  `confidence`; confidence gates the shift and blocks risky down-shifts; **`mergeProfiles()`
  community cold-start** — the network-effect moat (a population prior new users inherit). Routes
  feed `questionKind` into feedback; RoutingChip surfaces kind/confidence/learned.
- **Rigorous stats** (`stats.ts`, `tokens.ts`, `accounting.ts`): tokenizer-generation 1.3x
  correction for 5-family, measured-vs-modeled `TokenFigure` provenance (routes pass
  `measured: !mock`), per-purpose/per-model spend, savings curve. Economics panel surfaces it.
- **Moat**: `MOAT.md` — honest read (engine/tree are NOT moats; the per-user→cross-user routing
  flywheel + owning the brief-fidelity benchmark ARE). `BENCHMARK.md` formalizes the eval.
- **OSS A-**: `bonsai-engine` publishable via `pnpm publish` (tsup `dist` + `publishConfig`
  swap; workspace source resolution untouched so build stays green); injectable logger
  (`logger.ts`, `setEngineLogger`/`silenceEngine`); live-provider mocked-fetch tests; CHANGELOG;
  CI dist-build smoke. Recruiter README with live screenshot (assets/generated/).
- Gates: 168 unit tests, 10/10 evals, root build, extension build, engine tsup dist — all green
  in CI. `pnpm publish` is the publish path (npm doesn't honor the `publishConfig` field-swap).

## 2026-08-11 — Web app redesign: "sumi-e ink on rice paper"

The hackathon dark theme (and its relics — "Person B owns app/api") replaced by a genuinely
designed, anti-vibecode UI grounded in the subject (bonsai = the art of pruning). See DESIGN.md.
- Committed light theme: rice-paper background, sumi-ink text, bark/rule structure, ONE restrained
  moss accent. Type: Fraunces (display serif), Instrument Sans (body — not Inter), IBM Plex Mono
  (data readouts). No purple/indigo gradients, no shadcn `rounded-2xl shadow-lg` cards, no
  left-border accent strip, no cardocalypse — verified against anti-vibecode checklists.
- Cost is a horticultural **season scale** (young growth → summer → ember), never a cost-purple
  ramp — used on the branch buds, kickers, edges, and the economics bars.
- The **garden** (branch tree) is the signature: trunk + boughs curving to buds, active path inked
  in moss, each branch's pruning inscribed in its season. The Economics panel reads like a ledger/
  instrument (season savings bars + a mono per-inference log), not a debug modal.
- Restyle split: engine of the design (fonts, tokens, globals, the garden tree, Workspace shell)
  by hand; the chat column and economics restyled by two subagents against an exact token spec so
  they couldn't drift generic. 124 tests green; deployed live to bonsai-connector.vercel.app.

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

**DEPLOYED + WIRED LIVE (2026-08-11):** new Vercel project `bonsai-connector`
(bonsai-connector.vercel.app), isolated from the `bonsai`/main demo, on the lane's Neon branch.
Gotchas hit and fixed: (1) new project defaulted to framework `None` → all routes 404; set
`framework: nextjs` via API. (2) team default SSO deployment-protection wall 401'd Anthropic's
egress; disabled via API. (3) the route's `WWW-Authenticate: Bearer` on 401 made claude.ai attempt
OAuth DCR instead of authless — removed (authless connectors must not advertise auth). (4) a digit
dropped while typing the key into claude.ai's dialog → persistent 401; caught it in the Vercel
runtime logs and registered the key claude.ai actually holds. **The connector is now connected in
Tarun's claude.ai (Max) account** with all 4 tools discovered and permission-gated. Connector URL +
key recorded in the project memory (not committed to the repo).

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

## 2026-08-11 — Segment 1: engine extracted to `bonsai-engine`

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

## 2026-08-12 — Extension e2e, population prior, benchmark v2

Six commits (`a8fa27a`…`9591fc9`), all gates green (175 unit tests, 15/15 evals, web + extension
builds, extension e2e 13/13).

- **`extension/test-e2e.mjs`** — the smoke the last handoff asked for, as a permanent harness:
  Playwright + real Chromium + `--load-extension`, claude.ai fully route-intercepted with a local
  ProseMirror fixture (no login, zero account risk). Asserts prefill, pending-key consumption,
  LINK_NODE, chip lifecycle, and never-send at the network layer with a canary POST proving the
  detector isn't vacuous. Review of the harness surfaced a real extension bug: cold-start race
  between the SW's `setAccessLevel` and the content script's `storage.session` read — fixed with
  a bounded retry.
- **Population prior** (PLAN item 4 — the network-effect moat's missing plumbing):
  `loadPopulationPrior()` + injection into chat/branch `route()` + public `GET /api/priors`.
  Security review same session (verdict fix-first) → per-contributor clamp, k=10, sub-k count
  suppression, single-flight cache, `updated_at` index (migration 005). Sybil residual accepted
  and documented — unsigned free sessions cap what the clamp can't.
- **Benchmark 10→15**: ambiguous antecedent, long-trunk salience (retention AND ≥60% pruning),
  depth-3, population prior, merge loop. Depth-3 failed honestly on first run — the compiler
  compiled a dangling "It closes September 11" — and drove the engine fix: `anchorFact` pinning
  through compositions (`assemblePath` → `compileBrief`), unit-tested.
- **DB**: 004 + 005 applied to `br-old-fog-avfznwqu` via Neon MCP (Tarun-approved, additive only;
  legacy DELETE skipped). Local dev verified with real models end-to-end. Prod promote is now just
  `vercel --prod`.

## 2026-08-12 — Five-surface audit + product hardening

Tarun promoted to production (`vercel --prod`) and ran the live-model eval. A 5-auditor sweep
graded every access surface "can a stranger use this today?"; the ranked gaps got fixed the same
session (commits `1a80412`…`a529033`): web onboarding/mobile/touch/mock-honesty/OG, connector
anchor enforcement + structured output (live-verified over MCP JSON-RPC), honest install docs on
extension/plugin/engine, CI dist-freshness + plugin smoke gates. Access policy decided: the API
key never rides a public deployment — previews behind Vercel Auth + shareable links carry it;
production stays keyless mock with the demo ribbon. Remaining for promotion day: plugin lives
only on copy-a (marketplace install fails from main), extension has no icons, connector routing
hints don't yet consult the priors.

## 2026-08-18 — Phase 4: app usability (9 commits, gates green: 192 tests, 15/15 evals, CI GREEN)

Session goal (Tarun): "make it usable as an app — way more features, real, not slop."

- **Message actions** (`/api/message`, engine `truncateForRerun`): regenerate the last answer,
  edit-and-rerun the last user turn. Truncation queues REAL row deletes (`pendingMessageDeletes`,
  cleared only after the whole commit lands — deletes are idempotent, so a mid-commit failure
  stays retryable); the replayed turn goes through the shared `lib/chat-turn.ts` path extracted
  from the chat route (verified byte-identical behavior). Rename (double-click the title) and
  archive/unarchive without merging (`/api/node`; roots can't archive).
- **Streaming chat**: `POST /api/chat/stream` (SSE: delta / restart / done / error), native
  Anthropic streaming in the engine (`callAnthropicStream` — usage totals, refusal rule, reader
  cancelled on mid-parse throws), mock replays its answer as a paced stream so keyless demos show
  the same UI, escalation/widen fire a `restart` that clears the partial render, client abort
  propagates all the way to the provider fetch (abandoned tabs stop paying for tokens). Buffered
  route kept for the extension/evals + as the client's fallback. Verified live in Chromium with a
  real model (Haiku, served-by chip measured).
- **⌘K command palette** (`lib/search.ts` + `CommandPalette`): ranked search over every branch
  title, message, and insight (AND terms, snippets, archived sinks), quick actions (new chat,
  economics, exports), full keyboard nav.
- **Export**: `GET /api/export?format=md|json[&branch=…]` — whole garden or subtree, Markdown
  (headings by depth, briefs, insights, routing per turn) or versioned JSON. Palette actions.
- **Connector**: fork's model/effort are now optional — omitted, Bonsai routes the question with
  the engine classifier + community population prior (the documented open gap); explicit picks
  get a divergence hint + `suggestedRouting` in structuredContent.
- **Extension icons**: bonsai glyph rendered from SVG via Playwright (`extension/make-icons.mjs`),
  16/32/48/128 wired into the manifest; README pin note updated.
- **CI was red since 08-12** (every push emailed a failure): root `npm ci` never installed
  `plugin/mcp`'s own deps (not a workspace), so the smoke's spawned `server.mjs` died on
  `@modelcontextprotocol/sdk`. CI now `npm ci --prefix plugin/mcp` first. Also caught: the
  extension bundle needed a `providerCompleteStream` stub (never-send stays structural). Both
  fixed — copy-a CI is green for the first time since 08-12. Full CI sequence now runs locally
  before every push.
- **First-visit session race found by the browser click-through**: `/api/state` and
  `/api/economics` raced to mint the first session cookie; when economics won, every later chat
  404'd against a root the state response never described. Economics no longer sets cookies —
  `/api/state` is the only GET minter.
- Reviews each segment (react/ts + api/security agents): all findings fixed same-session —
  scroll-on-regenerate, memo-defeating closures, stream reader leak, abort plumbing, retryable
  truncation deletes. One reviewer corrupted node_modules with a stray pnpm install (restored
  with npm, gates re-verified; reviewers now instructed never to run installs).

## 2026-08-19 — Phase 4 wave 2: streaming parity + session hardening (2 commits, 204 tests, CI green)

- **Regenerate/edit stream too**: SSE scaffolding extracted to `lib/sse-turn.ts` (chat and
  message replay speak one protocol), `POST /api/message/stream`, client `streamTurn` helper
  shared by send + messageAction, optimistic truncation so discarded turns leave the screen
  while the replacement streams in (server reconciles, failure restores). Verified in Chromium
  against real models: regenerate keeps thread shape, edit replaces the turn and reruns.
- **Session hardening** (the documented Sybil-residual item, built by a subagent, reviewed):
  `SESSION_SECRET` HMAC-signs the session cookie (`id.sig`, timingSafeEqual, fresh garden on any
  tamper; unset = today's unsigned mock-first behavior, warned once). New `lib/rate-limit.ts`
  sliding window per session — inference 20/min (chat/stream/message/branch/merge), mutation
  60/min (node/conversation/reset/demo) — 429 with an honest retry-in body; per-instance caveat
  documented. Live-verified: the 61st mutation in a minute got 429.
- Export download switched to an anchor click (lint: no location.assign for internal URLs).
- To enable signing in prod: `vercel env add SESSION_SECRET` (any long random string), redeploy.

## 2026-08-19 — Extension: last-mile verified + panel polish (206 tests, both e2e suites green)

- **Panel e2e** (`extension/test-panel-e2e.mjs`, `npm run test:e2e:panel`) — the buttons every
  handoff said only a human could click are now machine-verified: sidepanel.html runs as an
  extension tab beside a fixture chat tab, claude.ai's read API fulfilled locally and the domain
  DNS-pinned to 127.0.0.1 (an SW-opened tab navigates before route interception attaches — the
  pin guarantees nothing real is ever reached; the harness caught exactly that escape). Proves
  compile → brief preview, Open branch chat → prefilled composer via the SW pending path,
  Merge to parent → prefilled parent chat, node lifecycle draft→merged, and never-send across
  every panel-driven flow. 8/8.
- **Panel UI polish**: real bonsai icon in the header (was emoji); `econLine()` phrases tiny-
  thread compiles honestly ("~54 tok thread → 67 tok brief · nothing to prune yet" instead of a
  bug-looking "0% pruned" next to growth) in both the preview and tree cards, unit-tested; the
  empty tree state now teaches the four-step loop instead of "No branches yet."
- Toolbar click already opens the panel (`openPanelOnActionClick`) and the icons landed
  yesterday, so install → click icon → panel is the whole onboarding path.

## 2026-08-19 — SHIPPED PUBLIC: prod promoted + MCP Apps garden view live in claude.ai

- **Production promoted** (Tarun ran the promote; agent CLI prod-flips are classifier-blocked):
  bonsai-connector.vercel.app now serves Phase 4 + wave 2 + panel fixes. Verified live:
  SSE chat and regenerate stream, truncation persists on the prod DB, export, palette,
  onboarding, honest demo ribbon, rate limits.
- **MCP Apps garden view** (`bonsai_tree` → `ui://bonsai/tree.html`, SEP-1865): a 4KB
  self-contained HTML app speaking the host protocol by hand (ui/initialize handshake,
  tool-result render from structuredContent, size-changed autosize, host-proxied Refresh when
  hostCapabilities.serverTools) instead of the 393KB official client bundle. Registered with
  both `_meta.ui.resourceUri` spellings + RESOURCE_MIME_TYPE. Unit tests pin the handshake
  markers and meta wiring; fixture-rendered in Chromium; **verified rendering INLINE in
  Tarun's real claude.ai on first try** — live garden totals 9 branches · 99.6% pruned
  (screenshot: assets/generated/mcp-apps-live-claude-ai.jpg).
- Full loop also live-verified this session: fork (76.4% pruned brief) → branch chat →
  bonsai_merge back, all on the production connector against the real DB.
