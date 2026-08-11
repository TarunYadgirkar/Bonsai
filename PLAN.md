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

## Surface decision (segment 6) — criteria

- Must draw on the user's existing monthly subscription, not an API key.
- Must be legitimate — no fragile reverse-engineering of private endpoints as the primary bet.
- Must exercise the engine (briefs, routing, merge), not just decorate a chat window.

Current lean: **Claude Agent SDK CLI/plugin** — Agent SDK sessions authenticate via the local
`claude` login (subscription-backed), fork/branch maps naturally onto sessions, and a Claude
Code plugin can make "branch = subagent with a compiled brief, merge = distilled insight back"
real inside coding sessions. Extension/MCP findings may revise this.

## Non-goals for this lane (for now)

- No durable cross-conversation memory layer — still an open decision per AGENTS.md.
- No coordination with copy-b.
- Web app stays a demo/testbed; it is not the product bet.
