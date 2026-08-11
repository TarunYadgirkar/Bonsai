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

## Segments

| # | Segment | State |
|---|---------|-------|
| 0 | Toolchain (tsx, vitest, typecheck) + this memo | in progress |
| 1 | Extract `@bonsai/engine` package — injected LLM fn, Store interface, split types, unit tests | pending |
| 2 | True semantics — path-based compile, closed merge loop, context-first escalation, brief budgeting | pending |
| 3 | Live provider fixed — per-model param policy, real effort mapping, streaming, honest accounting, correct pricing | pending |
| 4 | Relational persistence on Neon (per-row writes, ULIDs) + API hardening (zod, error wrapper, guarded reset) | pending |
| 5 | Eval harness — referent-resolution assertions, routing evals, cost benchmark from the fixture pipeline | pending |
| 6 | Subscription-riding surface — chosen after research (leading: CLI/TUI on Claude Agent SDK, which rides `claude` login; Chrome extension and remote-MCP connector under evaluation) | research running |
| 7 | Web demo truth pass — streaming, error surfacing, markdown, persisted pins, honest economics; PRODUCT.md rewrite | pending |

Each segment: build clean → commit → push. Reviews per repo auto-routing.

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
