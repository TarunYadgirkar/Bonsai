---
name: tree
description: Show the Bonsai conversation tree for this project — every branch with its model, effort, pruning economics, and merged insights. Use when the user asks "show the tree", "what branches do we have", "bonsai tree", or wants the session's branching overview.
---

# Bonsai tree

Call the `bonsai_tree` MCP tool with `{cwd: <project cwd>}` and show the user the rendered
tree as-is (it is preformatted: status glyphs, tier · model · effort per node, edge economics,
insights under merged nodes, totals footer).

Follow-ups this skill owns:
- "abandon that branch" → `bonsai_abandon {branchId, cwd}`.
- "reset the tree" → confirm with the user first, then `bonsai_reset {cwd, confirm: true}` —
  it deletes this project's tree permanently.
- Numbers questions ("how much did we prune?") → answer from the totals footer; the
  counterfactual is what full-copy forking would have carried.
