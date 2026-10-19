# BriefBench — the brief-fidelity benchmark

Every shipping fork feature (ChatGPT, Gemini, LibreChat, Open WebUI, …) is Save-As: the branch
drags the entire parent history along. Bonsai forks with a **compiled minimal brief** instead.
BriefBench measures whether that compression is *safe*: does the brief keep exactly the facts
the side-question depends on, at a fraction of the tokens?

## What it measures

**Fidelity** (the hard part): each compiler case asserts that specific load-bearing facts —
names, dates, numbers, resolved referents — survive into the brief. The nasty cases are the
point: referents the fork's question never names (depth-2 and depth-3 chains where only brief
composition can carry the entity), ambiguous antecedents, and a salience case where raw keyword
overlap ranks a noise sentence above the answer.

**Efficiency** (the receipt): every compiler case also measures the full-history baseline — the
tokens a Save-As fork would have sent (the whole assembled path + question) — and reports the
reduction the brief achieved *at that fidelity*.

Routing cases (tier thresholds, coverage flags), the learning-router case, the population-prior
case, the distiller contract, and the closed-merge-loop case ride in the same harness.

## Run it

```bash
git clone https://github.com/TarunYadgirkar/Bonsai && cd Bonsai && npm install
npm run eval            # mock mode — deterministic, no keys, what CI gates on
npm run eval -- --json  # + machine-readable results

ANTHROPIC_API_KEY=… npm run eval   # live mode: the same assertions grade real model output
```

Nonzero exit on any failure. The harness is ~700 lines of plain TypeScript
(`evals/run.ts`, `evals/cases.ts`) — read it before trusting it; that's the intent.

## BriefBench-XL

`npm run eval:xl` runs 300 generated cases (`evals/xl/eval.jsonl`) through the real engine:
60 each of depth-1 referents, ambiguous antecedents, salience, long trunks and depth-2 chains.
Each depth-2 case compiles its first brief, holds the branch conversation, then forks again,
so the second brief only passes if composition carried the entity through.

| Check | What fails it |
|---|---|
| Referents | A required entity is missing from the final brief. |
| Hallucination | The brief names an entity from another conversation, or a number the source never stated. |
| Prune | A level pruned less than its case's floor (`min_pruned_pct`). |

The cases come from `research/distill` (`scripts/gen_data.py`, seed 7, the held-out eval split:
entity vocabulary and surface templates both differ from the training split). The grader is a
port of that project's `checks.py`, so a distilled student and the engine are graded alike.

CI compares each run with `evals/xl/baseline.mock.json` and fails on a lower pass or referent
rate, or a higher hallucination rate, overall or in any family. With a key the same cases grade
the live compiler; `npm run eval:xl -- --write-baseline` records a baseline for that provider.
The mock scores 100% here, so in mock mode this is a regression gate for the extractive path
and post-processing, not evidence of model quality. There is no downstream-QA judge yet.

## Honest caveats

- **Mock mode is a plumbing gate, not a model eval.** The extractive mock proves path assembly,
  anchor pinning, salience ranking, and routing thresholds deterministically. Live mode grades a
  real compiler; run it with a key before quoting numbers as model performance.
- **Fixtures are deliberately tiny** (a few turns each), so the reported reduction (~44% in mock
  mode) is a conservative floor. Real conversations prune far harder — the bundled demo tree
  measures 97%+ per fork — but we report what the benchmark actually runs, not the best case.
- **Containment scoring is exact-substring**, which is strict on the compiler (paraphrase counts
  as a miss) and generous on the baseline (full history trivially contains everything). That
  asymmetry favors the baseline, not us.
- **The token reduction is not the dollar reduction.** A cache-shared native fork re-reads the
  parent history at the cache-hit rate (0.1x list input; 0.05x on Opus 5.5, 0.025x on Fable 5.1), so a 44% token
  cut is a much smaller dollar cut against a warm fork. The app's ledger reports both baselines;
  quote the warm one when the comparison is Claude Code's `/fork`.
- Third-party runs, adversarial cases, and PRs adding failure modes are welcome — a benchmark we
  only ever pass at home proves nothing.
