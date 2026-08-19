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
- Third-party runs, adversarial cases, and PRs adding failure modes are welcome — a benchmark we
  only ever pass at home proves nothing.
