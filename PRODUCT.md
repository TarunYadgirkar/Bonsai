# Bonsai

**Branch the thought, not the transcript.**

Every chat product stores conversation as one growing log, and every branching feature shipped
so far — ChatGPT's "Branch in new chat" (Sept 2025), Gemini's copy of it (May 2026), Claude
Code's `/fork` and `/btw`, LibreChat, Msty, TypingMind — forks by **copying the full history**.
That is Save-As, not branching: the copy drags every token of context along and the side question
runs on the priciest possible context. Claude Code's `/fork` (a background subagent that inherits
the whole transcript and returns its result, default since v2.1.232) closed the "nothing comes
back" gap in August 2026. It did not touch the other three: the copy is still total, the branch
runs on the parent's model, and there is no tree.

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

Bonsai rides a user's existing subscription on three surfaces; a standalone bring-your-own-key
web app was ruled out as the product bet (the value is riding the session you already pay for).

| Piece | State |
|---|---|
| `bonsai-engine` | The core as a dependency-free TS package: tree model, path assembly, brief compiler, coverage-aware router, context-first escalation, **a learning router** that personalizes from your overrides/escalations/merges, and a provider layer with honest per-model pricing. Unit-tested; runs in CI. |
| Eval harness | `npm run eval` proves the moat: referent resolution held at depth 1 and depth 2 (through composed briefs), coverage flagging, routing thresholds, distillation, and the learning router adapting. Runs in CI. |
| Claude Code plugin | `plugin/` — branch = subagent spawned with a compiled brief on a routed model+effort, merge = enforced one-insight return, tree persisted by a bundled MCP server. Runs on your Claude Code subscription. Verified end-to-end. |
| Chrome extension | `extension/` — MV3 side panel over claude.ai. Reads your conversation (same-origin), compiles a brief locally, pre-fills the branch and the merge-back into the composer. Strictly human-in-the-loop: it never sends — you do. The local compile is extractive (no model call); the plugin and connector compile with Claude for higher fidelity. |
| MCP connector | `app/api/mcp/[key]` — a claude.ai custom connector (remote MCP). Claude compiles the brief in-conversation and passes it as a tool argument; the connector stores the tree and formats. Deployed and connected in a live claude.ai account. |
| Web app | Hosted demo + engine testbed (this repo, Vercel). Mock-first: runs with zero keys. |

## The learning router (and the moat)

The router personalizes. When you upgrade a branch it picked as cheap, escalate a too-small brief,
or merge an answer back, that's a labelled example — learned **per question kind**, so your
rewrites route cheap while your "analyze" routes deep. Once a pattern is clear the router pre-empts
the classifier and tells you why ("you've upgraded comparison quick picks 7/7 times, so this one
starts at thoughtful"), tempered by how confident the classifier was in its read. Two people type
the same prompt and get different routes because their histories differ.

This is where the defensibility is. Per user it's a switching cost; aggregated across users
(`mergeProfiles` → a community cold-start prior every new user inherits) it's a genuine network
effect — the routing memory gets sharper for everyone as more people use it. That flywheel, plus
owning the brief-fidelity [benchmark](BENCHMARK.md), is the [moat](MOAT.md). Signals are real
behavior, not an AI judge; priors persist per user.

## Roadmap (deliberately not built yet)

- **MCP Apps tree UI** — an interactive Bonsai tree rendered inline in claude.ai (the connector
  already returns `structuredContent` so this slots in). The connector today returns a markdown
  tree; the interactive view is the next step.
- **OAuth for the connector.** v1 uses a per-user garden key in the URL; OAuth adds real
  per-user identity, consent, and revocation without handing out a key.
- **Durable cross-conversation memory.** Deliberately absent. Whether Bonsai needs it — and
  what should provide it — is an open decision, not a default.
- **Streaming surfaces.** The engine escalation ladder is whole-response; streaming lands with
  the first surface that needs it.

## What native `/fork` changed (2026-09-21 read)

Merge-back is no longer unclaimed: Claude Code forks return their result to the parent. Three
things stay Bonsai's, and they are the three that were always the product:

- **The compiled brief.** A native fork copies the whole transcript. Bonsai sends ≤8
  referent-resolved facts. On the API that is the bill; on a subscription it is usage headroom;
  on every surface it is immunity from the parent's noise.
- **Cross-model routing.** A native fork runs on the parent's model. Bonsai routes the branch
  to the cheapest model and effort that covers the question, and never overrides a manual pick.
- **The one-insight contract and the tree.** A native fork returns whatever it returns, and
  the tree is invisible. Bonsai returns one grounded, referent-resolved sentence and keeps the
  map with per-branch economics.

The economics claim had to change with it. A cache-shared fork reads the parent history at the
cache-hit rate, so the ledger now shows two baselines: full copy at list price and full copy
with the whole history priced as cached. Bonsai leads with the second one.

## Positioning in one paragraph

Everyone else's branch is a full copy on the same model. Bonsai branches start from a compiled
minimal brief, get routed to the right model and effort automatically, and return exactly one
distilled insight to the parent — riding the Claude subscription you already pay for.
