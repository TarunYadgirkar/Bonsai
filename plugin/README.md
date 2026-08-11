# Bonsai — Claude Code plugin

Branch side questions off your Claude Code session with a *compiled minimal context brief*
instead of the full conversation, auto-route each branch to the right model + effort, and merge
exactly one distilled insight back. Everything runs on your existing Claude subscription — the
brief is compiled by your session, branches are subagents, and a local MCP server keeps the
tree and the pruning economics.

Native `/fork` copies your ENTIRE context into the branch. Bonsai compiles what the question
actually needs (typically 95%+ pruned), which keeps branches cheap against your rate limits and
immune to context poisoning — and unlike anything native, the branch's conclusion merges back.

## Install

```
/plugin marketplace add TarunYadgirkar/Bonsai
/plugin install bonsai@bonsai
```

The tree server ships pre-bundled (`mcp/dist/server.mjs`, self-contained) — no install
step. Contributors editing `mcp/server.mjs` must rebuild it: `node mcp/build.mjs`.

## Use

- "branch this: <side question>" — compiles a brief, routes, spawns, merges the insight back.
- "show the bonsai tree" — the session's branch map with per-edge economics.
- "branch this on opus max" — pins model + effort; routing never overrides an explicit pick.

## Pieces

| Path | What |
|---|---|
| `skills/branch` | The loop: compile brief → `bonsai_fork` → spawn tier agent → `bonsai_merge` |
| `skills/tree` | Tree rendering + abandon/reset |
| `agents/` | `bonsai-branch-{quick,thoughtful,deep}` — Haiku/Sonnet/Opus executors |
| `mcp/` | stdio server: tree persistence, deterministic routing, economics |
