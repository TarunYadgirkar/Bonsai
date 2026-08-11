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
| **Salience** | The answer sits in a rare-term sentence surrounded by common-word noise (a $55k Hertz stipend among "all programs offer full tuition"). A raw keyword-overlap compiler *excludes* it; the salience compiler ranks it first. Genuinely differential. |
| **Routing** | A lookup routes cheap, a multi-constraint ranking routes deep, and an uncovered question is flagged `covered: false` before any spend. |
| **Learning** | After repeated upgrades, the same question re-routes up a tier — with the reason attributed to the user's history. |
| **Distillation** | A merge returns one referent-resolved sentence under the word cap. |

## Why it's a benchmark, not just tests

- It grades *behavior a model produces*, not code paths — so it transfers across providers and
  across compiler implementations (extractive mock, live model, a future re-write).
- It is **differential**: the salience and depth-2 cases fail on the naive implementations everyone
  reaches for first (keyword overlap; single-parent compilation). Passing them means something.
- It runs in CI on every push, so a regression in brief fidelity fails the build.

Extending it — more scenarios, adversarial referents, longer trunks — is the highest-leverage way
to widen the correctness moat. Cases live in `evals/cases.ts`; the runner is `evals/run.ts`.
