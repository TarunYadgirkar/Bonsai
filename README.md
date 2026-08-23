# bonsai-distill

Can a 0.5B–1.5B model learn context-compilation behavior from a larger teacher?

Extends [Bonsai](https://github.com/tarunyadgirkar)'s context compiler — which turns a long
conversation into a minimal, referent-resolved brief at every fork — into a distillation
experiment. Three conditions, one grader:

| Condition | Training |
|---|---|
| **base** | Qwen2.5-0.5B/1.5B-Instruct, zero-shot on the compiler prompt |
| **sft** | off-policy SFT on Claude-teacher gold briefs (rejection-sampled) |
| **gkd** | on-policy generalized knowledge distillation (TRL `GKDTrainer`), open teacher, starting from the SFT checkpoint |

The grader is BriefBench's method scaled up: entity-presence assertions over the compiled
brief, so every condition (and the teacher itself) is graded by the same string-level checks.
On-policy KD exists to close the train/inference sequence mismatch; the depth-2 composition
family is where that mismatch bites hardest (the student consumes its OWN level-1 brief at
level 2), so `by_family` deltas are the headline result.

## Task contract

Verbatim from `bonsai-copy-a/packages/engine/src/compiler.ts`: system prompt +
profile/selection/question/path-markdown user turn → JSON `{"facts": string[],
"excludedNote": string}`. A trained student is a drop-in for the engine's `complete()`
compile call.

## Scenario families (datagen.py)

Generalize `evals/cases.ts` from 15 hand-built cases to thousands, split by **entity
vocabulary** (eval conversations never mention a train-pool entity) and surface template:

- `depth1_referent` — dangling referent ("when do apps close?") must resolve to the named org + date
- `ambiguous` — two deadlines in the trunk; the highlighted selection anchors the right one
- `salience` — rare-term fact surrounded by noise sharing the question's common words (the extractive-mock killer; verified differential in `smoke_mock.py`)
- `long_trunk` — one buried fact among 10–16 filler exchanges, ≥60% prune floor
- `depth2` — root names the entity, the branch transcript never does; only brief composition resolves it

## Metrics

referent preservation · hallucination (pool distractors + unsupported-number scan) ·
prune/compression ratio · downstream QA (Haiku answers from the brief alone) · parse rate ·
latency · output tokens — overall and per family.

## Pipeline

```bash
uv sync                                     # datagen + teacher + eval (no torch)
python scripts/gen_data.py 2000 300         # data/examples_{train,eval}.jsonl
python scripts/smoke_mock.py                # keyless harness check (extractive mock)
python scripts/gen_teacher.py               # ANTHROPIC_API_KEY; rejection-sampled gold briefs

uv sync --extra train                       # cloud GPU (or --smoke locally w/ SmolLM2)
python scripts/train_sft.py
python scripts/train_gkd.py --student runs/sft            # lmbda=0.5 beta=0.5
python scripts/train_gkd.py --student runs/sft --pure-on-policy --out runs/gkd-op

python scripts/run_eval.py --model Qwen/Qwen2.5-0.5B-Instruct --name base --judge
python scripts/run_eval.py --model runs/sft --name sft --judge
python scripts/run_eval.py --model runs/gkd --name gkd --judge
python scripts/run_eval.py --teacher --name teacher --judge   # ceiling
```

## Notes

- Token-level GKD requires student and teacher to share a tokenizer — asserted at startup.
  Default pairing Qwen2.5-0.5B ← Qwen2.5-7B (14B via `--teacher` on a bigger GPU).
- Claude teacher generates the SFT targets; the open teacher drives GKD. Rejection sampling
  keeps only briefs that pass the same checks the eval uses — the quality gate is the benchmark.
- `smoke_mock.py` runs the entire harness with zero keys and zero torch, mirroring Bonsai's
  mock-first rule. The mock's failure profile (100% depth-1, 0% salience) is the proof the
  benchmark measures behavior, not plumbing.
