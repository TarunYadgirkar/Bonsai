# Bonsai

**Branch the thought, not the transcript.**

Every chat product stores conversation as one growing log, and every branching feature shipped
so far — ChatGPT's "Branch in new chat" (Sept 2025), Gemini's copy of it (May 2026), Claude
Code's `/fork`, LibreChat, Msty, TypingMind — forks by **copying the full history**. That is
Save-As, not branching: the copy drags every token of context along, the side question runs on
the priciest possible context, and nothing the branch learns ever comes back.

Bonsai is the loop those products don't have:

1. **Fork with a compiled brief.** A branch inherits a *compiled minimal context brief* — at
   most eight referent-resolved facts plus an explicit note of what was excluded — instead of
   the transcript. A 19,000-token parent becomes a ~300-token brief. Briefs compose
   recursively: a branch of a branch inherits resolution work already done above it.
2. **Route the branch.** The branch boundary is a routing signal the user provides for free:
   by forking, they declared "separate, smaller thought." A cheap classifier reads the brief
   and the question, picks model + reasoning effort, and flags when the brief doesn't cover
   the question — *before* paying for a doomed answer.
3. **Escalate context-first.** When an answer punts, the ladder widens the brief with parent
   turns and retries on the same model before it ever upgrades the model. Manual picks are
   never silently overridden — an override is the user's own labelled example.
4. **Merge one insight back.** A branch returns exactly one distilled, referent-resolved
   sentence to its parent — which then genuinely enters the parent's context and every future
   sibling's brief. The parent learns a conclusion, not a transcript.

The tree is commodity. The brief compiler, the branch-aware router, and the merge-back
contract are the product.

## Why minimal briefs (it isn't only cost)

- **On API surfaces** the math is direct: input tokens are the bill, and the compiled brief is
  the difference between every side question costing the whole conversation and costing a
  paragraph.
- **On subscription surfaces** (Claude Pro/Max) tokens aren't the user's cost — usage headroom
  is. Compiled briefs mean more branches per rate-limit window.
- **On every surface**: no context poisoning. A branch that can't see the parent's noise
  can't be misled by it, and an explicit excluded-note stops the model from assuming it has
  everything. Full-copy forks inherit every wrong turn.

Independent validation: Branchat (CHI 2026) measured user-scoped context in tree chat beating
linear chat on speed, cognitive load, and trust; "Conversation Tree Architecture"
(arXiv 2603.21278) formalizes almost exactly this model and names the context-poisoning
problem. Both are prototypes. Nobody ships the loop.

## What exists today

| Piece | State |
|---|---|
| `@bonsai/engine` | The core as a dependency-free TS package: tree model, path assembly, brief compiler, coverage-aware router, context-first escalation, provider layer with honest per-model pricing. 99 unit tests. |
| Eval harness | `npm run eval` proves the moat claim: referent resolution held at depth 1 and depth 2 (through composed briefs), coverage flagging, routing thresholds, distillation contract. Runs in CI. |
| Claude Code plugin | The primary surface. `plugin/` — branch = subagent spawned with a compiled brief on a routed model+effort, merge = enforced one-insight return, tree persisted by a bundled MCP server. Runs entirely on the user's existing Claude subscription. Verified end-to-end. |
| Web app | Hosted demo + engine testbed (this repo, Vercel). Mock-first: runs with zero keys. |

## Roadmap (deliberately not built yet)

- **claude.ai connector** — remote MCP + MCP Apps tree UI for claude.ai/Desktop users. The
  connector holds tree state, compiles briefs, and renders the tree; reasoning stays in the
  visible conversation (claude.ai has no MCP sampling). Needs hosting + OAuth.
- **The router that learns.** Today routing is a static classifier plus escalation. Overrides,
  regenerations, merge-rate and abandonment are the labelled examples a per-user router would
  train on. Logged already; not learned from yet.
- **Durable cross-conversation memory.** Deliberately absent. Whether Bonsai needs it — and
  what should provide it — is an open decision, not a default.
- **Streaming surfaces.** The engine escalation ladder is whole-response; streaming lands with
  the first surface that needs it.

## Positioning in one paragraph

Everyone else's branch is Save-As: a full copy that never comes back. Bonsai branches start
from a compiled minimal brief, get routed to the right model and effort automatically, and
return exactly one distilled insight to the parent — riding the Claude subscription you
already pay for.
