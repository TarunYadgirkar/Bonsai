# PLAN.md — lane A campaign

Lane A's direction memo. What this lane is building, in order, and why. Living document —
updated as segments land. Read `LANE.md` for lane boundaries, `AGENTS.md` for repo rules.

## Thesis

The deep-read (2026-08-11) found three load-bearing gaps between the pitch and the code:

1. **Merge is theater** — insights are stored and rendered but never re-enter any prompt.
2. **Path-based assembly doesn't exist** — the compiler sees only the immediate parent's
   transcript; referent resolution provably breaks at depth ≥ 2, and `prunedPct` claims credit
   for ancestor tokens the compiler never saw.
3. **The live Anthropic path is 3/4 broken** — unconditional `temperature` 400s on every rung
   above Haiku (silent mock fallback), effort never maps to the real API effort control, and the
   pricing table overstates savings ~3x.

Lane A's bet: **make the pitch true, then put it on a surface that rides the user's existing
Claude subscription.** The engine (tree model + path-based context assembly + honest routing
economics) is the durable asset; every surface is thin once it is solid.

## Current state (2026-08-11) — READ AGENTS.md `## Ongoing` first

Everything below is **DONE and on `copy-a`** (not promoted to `main`; bonsai-lac still runs the
old build). Full state + "next" live in `AGENTS.md → ## Ongoing`; the record is `BUILDLOG.md`.
168 unit tests, 10/10 evals, CI green.

## Segments — Phase 1 (make the pitch true, put it on subscription surfaces) — ALL DONE

| # | Segment | State |
|---|---------|-------|
| 0 | Toolchain (tsx, vitest, typecheck) + this memo | done |
| 1 | Extract `@bonsai/engine` package — injected LLM fn, Store interface, split types, unit tests | done |
| 2 | True semantics — path-based compile, closed merge loop, context-first escalation, brief budgeting | done |
| 3 | Live provider fixed — per-model param policy, real effort mapping, honest accounting, correct pricing | done |
| 4 | Relational persistence on Neon (per-row, random ids) + API hardening (zod, error wrapper, guarded reset) | done |
| 5 | Eval harness — referent-resolution + routing + salience benchmark (`BENCHMARK.md`) | done |
| 6 | Subscription surfaces: **plugin** (primary) + **MCP connector** (deployed+wired live) + **Chrome extension** (HITL) | done |
| 7 | Web demo truth pass — error surfacing, markdown, persisted pins, honest economics; PRODUCT.md rewrite | done |

## Segments — Phase 2 (recruiter-grade, moat, insane engine) — ALL DONE

| # | Segment | State |
|---|---------|-------|
| 8 | Web app **redesign** — sumi-e ink on rice paper, garden signature, season cost scale (`DESIGN.md`); deployed | done |
| 9 | **Learning router v2** — per-question-kind priors + classifier confidence + `mergeProfiles()` community cold-start | done |
| 10 | **Salience compiler** + **rigorous stats** (tokenizer-gen correction, measured-vs-modeled provenance) | done |
| 11 | **Moat** (`MOAT.md`) + recruiter README + **`@bonsai/engine` publishable** (tsup dist, `pnpm publish`) + logger + provider tests | done |

Each segment: build clean → commit → push. Reviews per repo auto-routing.

## Next (a fresh session picks; nothing in flight)

Phase 3 (2026-08-12): the 36-finding adversarial audit is fully fixed + live-tested on a preview
deploy — see BUILDLOG. Open items, in order:

0. **Promote to production.** Migrate the LIVE Neon branch `br-old-fog` with `migrations/004`
   (the classifier blocked DDL there — do it in the Neon console), then `vercel --prod` from the
   worktree (linked to bonsai-connector). Migration must land BEFORE the deploy or writes 503.
1. **Finish the extension smoke**: confirm selection → Compile → Open branch chat prefills the
   brief and nothing sends (only the panel buttons are unverified; content script + Branch chip are
   confirmed live). Two paths — (a) a **local Playwright harness** with `--load-extension` that
   seeds the extension service worker's `chrome.storage.session` and asserts prefill/no-send
   (Claude Code can build+run this; covers everything but the literal panel clicks); (b) Cowork
   local computer use (next session on Desktop) or a human for the actual panel buttons.
2. (Optional) real models on the web deploy: `vercel env add ANTHROPIC_API_KEY preview` → redeploy.
3. Promote `copy-a` → `main`/live demo when ready.
4. **Population-prior data pipeline** (the moat's remaining work) — server-side anonymized
   aggregation feeding `mergeProfiles`; the engine mechanism is built + tested, the plumbing isn't.
5. Publish the brief-fidelity benchmark publicly; expand scenarios.
6. `pnpm publish @bonsai/engine`; MCP Apps interactive tree inline in claude.ai (connector already
   returns `structuredContent`); connector OAuth; streaming chat.

## Surface decision (segment 6) — DECIDED 2026-08-11

Research (5-agent sweep, sources in BUILDLOG) settled it:

**Primary: Claude Code plugin.** The one surface where the full Bonsai loop runs on the user's
existing Pro/Max subscription, sanctioned: branch = plugin subagent spawned with a compiled
brief (model + effort are literal agent-frontmatter fields — Bonsai's router maps 1:1), merge =
the subagent's distilled report returning to the parent (a SubagentStop prompt-hook can enforce
the one-insight contract), tree persisted by a bundled MCP server. Distribution = GitHub
marketplace repo, `/plugin install`. Zero hosting.

**Fast-follow: claude.ai custom connector (remote MCP) + MCP Apps tree UI.** claude.ai/Desktop
audience on their own subscription — but no MCP sampling exists there, so the connector can only
hold tree state, compile briefs, and render the tree (MCP Apps GA'd Jan 2026); reasoning stays
in the visible conversation. Needs public hosting + OAuth. Same engine core.

**Cut: Chrome extension over claude.ai.** Auto-sending through the consumer session is the
exact "automated or non-human means" pattern Anthropic banned accounts for (April 2026,
OpenClaw wave) — the risk lands on the user's account. Read-only tree viewers survive, but they
don't deliver the loop. Revisit only as a human-in-the-loop visualizer later.

**Positioning (from the competitive sweep):** branching is commoditized — ChatGPT, Gemini,
LibreChat, Msty, TypingMind all ship full-copy "Save-As" branches, and nobody ships compiled
briefs, per-branch auto-routing, or a distilled merge-back contract. Position on the loop, not
the tree. On subscription surfaces the economics pitch is rate-limit headroom + no context
poisoning, not dollars. Sherlock risk is real (native /fork rewritten twice in June 2026;
anthropics/claude-code#32631 specs fork+merge+tree) — the moat is brief quality + merge
contract, so the segment-5 eval harness is strategic, not hygiene.

## Non-goals for this lane (for now)

- No durable cross-conversation memory layer — still an open decision per AGENTS.md.
- No coordination with copy-b.
- Web app stays a demo/testbed; it is not the product bet.
