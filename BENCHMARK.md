# BriefBench

> The brief-fidelity benchmark: does a compiled fork keep exactly the facts the
> side-question depends on, at a fraction of the tokens? Method, run instructions, and honest
> caveats: [evals/README.md](evals/README.md). Mock-mode headline: 15/15 fidelity at a 43.8%
> token reduction vs the full-history Save-As baseline (tiny fixtures — a conservative floor).

# The Bonsai brief-fidelity benchmark

Compiled context is only useful if it stays *answerable*. A brief that drops a referent produces a
confidently wrong answer — the exact failure that makes full-copy branching "safe" and compiled
briefs risky. This benchmark *executes* the correctness claim rather than asserting it, and it is
the artifact Bonsai stakes its credibility on (see [MOAT.md](MOAT.md)).

Run it:

```bash
npm run eval            # mock provider — the CI gate
# with a key in .env.local, the same assertions grade a live model's briefs:
ANTHROPIC_API_KEY=… npm run eval
```

Every case builds a conversation in-process, forks it, and checks the compiled output. Assertions
are **entity-presence** checks, so the same suite grades the extractive mock and a live model
identically — a passing mock and a passing Opus 5 mean the same thing.

## What it measures

| Category | The claim it proves |
|---|---|
| **Referent resolution, depth 1** | A dangling referent ("when do *apps* close?") yields a brief naming the resolved entity ("Free Ventures", "September 11"). |
| **Referent resolution, depth 2** | Fork → a sub-conversation that never names the entity → fork again ("when is *the deadline*?"). Only brief *composition* can resolve it — full-copy products get this free by dragging the whole log; Bonsai must get it from the inherited brief. |
| **Referent resolution, depth 3** | One hop further: three compositions, no transcript below the root ever naming the entity. This case *found a real bug* — the compiler pruned the inherited entity when the new question didn't mention it, compiling a dangling "It closes September 11" — and drove the fix (the inherited brief's top fact is pinned through every composition: `anchorFact`). |
| **Ambiguous antecedent** | "When is *the deadline*?" with TWO deadlines in the trunk (NSF GRFP Oct 21 vs NeurIPS Sept 30). The highlighted selection must anchor the referent to the right one. |
| **Long-trunk salience** | One load-bearing fact buried mid-way through 12 near-identical filler exchanges must survive — AND the brief must prune ≥60% of the trunk, because retention alone is easy if you keep everything. |
| **Salience** | The answer sits in a rare-term sentence surrounded by common-word noise (a $55k Hertz stipend among "all programs offer full tuition"). A raw keyword-overlap compiler *excludes* it; the salience compiler ranks it first. Genuinely differential. |
| **Routing** | A lookup routes cheap, a multi-constraint ranking routes deep, and an uncovered question is flagged `covered: false` before any spend. |
| **Learning** | After repeated upgrades, the same question re-routes up a tier — with the reason attributed to the user's history. |
| **Population prior** | A brand-new user (empty profile) inherits the community's merged routing memory and routes a tier up — with the reason crediting the community. The network-effect claim, executed. |
| **Merge loop** | An insight distilled from a branch actually re-enters the parent's prompt context ("Learned from branches") — merge is not theater. |
| **Distillation** | A merge returns one referent-resolved sentence under the word cap. |

## Why it's a benchmark, not just tests

- It grades *behavior a model produces*, not code paths — so it transfers across providers and
  across compiler implementations (extractive mock, live model, a future re-write).
- It is **differential**: the salience and depth-2 cases fail on the naive implementations everyone
  reaches for first (keyword overlap; single-parent compilation). Passing them means something.
- It runs in CI on every push, so a regression in brief fidelity fails the build.

Extending it — more scenarios, adversarial referents, longer trunks — is the highest-leverage way
to widen the correctness moat. Cases live in `evals/cases.ts`; the runner is `evals/run.ts`.
