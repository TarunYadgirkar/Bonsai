---
name: branch
description: Branch a side question off the current conversation with a compiled minimal context brief, run it on the right model + effort automatically, and merge one distilled insight back. Use when the user asks a side question ("btw", "quick tangent", "while we're at it"), wants to explore an alternative without polluting the main thread, or says "branch this" / "bonsai this".
---

# Bonsai branch

Fork a side question into an isolated subagent that inherits a *compiled minimal brief* —
not the whole conversation — then merge exactly one distilled insight back. The branch runs on
a model + effort matched to the question, so cheap questions stop riding on expensive context.

## The loop

1. **Identify the fork.** The side question is `question`; the words/topic it grew from is
   `selection`. Everything else in the conversation stays behind.

2. **Compile the brief — you are the compiler.** Extract at most 8 short facts from THIS
   conversation that the question actually needs. The hard requirement is referent resolution:
   every fact must stand alone with no dangling "it/that/the app/the deadline" — write the
   name. If earlier Bonsai branches merged insights back, carry the relevant ones through
   verbatim. Order facts most-important first. Write one `excludedNote` sentence naming what
   you deliberately left out. Do NOT paste transcript; distill it.

3. **Register the fork:** call the `bonsai_fork` MCP tool with `{selection, question,
   briefFacts, excludedNote, title, cwd: <project cwd>, contextTokensEstimate: <your rough
   estimate of the full conversation's token size>}`. It persists the tree node, computes the
   pruning economics, and routes the branch — returning `agentType`, `covered`, and
   `subagentPrompt`.

4. **Coverage gate.** If `covered` is false, your brief probably misses what the question
   needs — add the missing facts and call `bonsai_fork` again (same title replaces nothing;
   just fork once you're satisfied). Don't spawn a doomed branch.

5. **Spawn the branch:** Agent tool, `subagent_type` = the returned `agentType`
   (`bonsai-branch-quick` | `bonsai-branch-thoughtful` | `bonsai-branch-deep`), `prompt` = the
   returned `subagentPrompt`, `run_in_background: false` for a quick answer the user is
   waiting on, background for a longer exploration beside main work.

6. **Merge back.** The branch's final message ends with `INSIGHT: <one sentence>`. Take that
   line (tighten it to ≤20 words, referents resolved — never a summary of the excursion) and
   call `bonsai_merge {branchId, insight, cwd}`. If the branch punted ("brief does not cover"),
   either widen — fork again with more facts — or call `bonsai_abandon`.

7. **Report to the user:** the branch's answer, the merged insight line, and one economics
   line from the fork result: `~N tokens compiled vs ~M full-copy (P% pruned)`.

## Rules

- One insight per merge. The parent learns a conclusion, not a transcript.
- Never spawn a branch without registering it via `bonsai_fork` first — an unregistered branch
  is invisible to the tree and its economics are lost.
- Forking off an existing branch: pass its `parentId` to `bonsai_fork` and carry the parent
  brief's FIRST fact verbatim as the new brief's first fact — referent closure across depth
  (mirrors the engine's `anchorFact` pinning).
- The user can pin: "branch this on opus max" → pass `pinned: {model, effort}` to
  `bonsai_fork`; routing respects it and never silently upgrades.
- `bonsai_tree` renders the current tree with per-edge economics whenever the user asks where
  things stand.
