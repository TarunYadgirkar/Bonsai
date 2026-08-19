# Show HN launch package

Prepared copy so the first hour is answering, not writing. Post when: engine is on npm, the
OAuth connector has been attach-tested once from a fresh claude.ai account, and prod has had a
quiet 48 hours.

## Title (pick one, keep the literal-noun HN register)

1. `Show HN: Bonsai – fork AI chats with a compiled brief instead of the whole history`
2. `Show HN: Tree-structured AI chat where branches merge back one insight`

## Post body

Just the repo link. HN convention: the story is the first comment.

## Founder first-comment (the honesty beat)

> Hi HN — I built Bonsai because every "branch this chat" feature that shipped (ChatGPT, Gemini,
> LibreChat…) is Save-As: the fork drags the entire history along, so the side question runs on
> the priciest possible context and nothing it learns ever comes back.
>
> Bonsai forks with a *compiled minimal brief* (≤8 referent-resolved facts + an explicit note of
> what was excluded), auto-routes each branch to a model + effort rung that learns from your
> overrides, and merges exactly one distilled insight back to the trunk. The pitch in one line:
> the cheapest token is the one you don't send.
>
> Honesty notes, because self-benchmarks deserve suspicion: the brief-fidelity benchmark
> (BriefBench, in the repo, `npm run eval`) is how I found my own worst bug — the depth-3 case
> compiled a brief whose top fact was "It closes September 11" with a dangling "it", which is
> exactly the failure mode this architecture risks; the fix (anchor-fact pinning through brief
> compositions) is unit-tested. Mock mode is a plumbing gate, not a model eval — the README
> says which numbers are measured and which are modeled, and the ledger marks unpriced upstreams
> as excluded rather than guessing.
>
> Surfaces: a hosted demo (honest mock unless you bring a key), a claude.ai connector (OAuth,
> renders the tree inline via MCP Apps), and a Claude Code plugin where branch = subagent with a
> compiled brief. The engine is a dependency-free TS package.
>
> The two questions I most want beat up: is the one-insight merge contract too strict, and does
> per-question-kind routing actually deserve to learn across users (community priors) or is
> that overreach?

## Response crib

- "Native tools will ship this" → Yes — Claude Code has fork+merge+tree spec'd. Full-history
  forks are what vendors are incentivized to ship (they bill by the token); compiled briefs and
  learned routing are the parts with no vendor incentive. That's the bet, stated in MOAT.md.
- "The savings numbers are self-reported" → Correct, which is why the benchmark ships with a
  full-history baseline arm, exact-substring scoring that favors the baseline, and a
  clone-and-run path. Run it, break it, PR a failure case.
- "Why not RAG the history instead of compiling?" → Retrieval answers "what's similar";
  compilation answers "what does THIS question depend on" — and composes across fork depth,
  which is where retrieval-over-transcript falls apart (the depth-3 case).

## Staggered follow-ups (per-surface, weeks apart)

1. Engine on npm (`bonsai-engine`) — a "compiled briefs as a library" angle for the LLM-infra crowd.
2. The connector + MCP Apps inline tree — the MCP-ecosystem angle.
3. The plugin — the Claude Code-workflow angle.
