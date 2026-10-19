# bonsai-distill

Can a 0.5B–1.5B model learn context-compilation behavior from a larger teacher?

Extends [Bonsai](../../README.md)'s context compiler — which turns a long
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

Verbatim from [`packages/engine/src/compiler.ts`](../../packages/engine/src/compiler.ts)
(`COMPILER_SYSTEM_PROMPT`; `test/distill-drift.test.ts` fails if the two copies diverge): system prompt +
profile/selection/question/path-markdown user turn → JSON `{"facts": string[],
"excludedNote": string}`. A trained student is a drop-in for the engine's `complete()`
compile call.

## Results so far

300-case eval split, no downstream-QA judge on the SFT row:

| Condition | Pass | Parse | Hallucination | depth2 | long_trunk | Compression | s/case |
|---|---|---|---|---|---|---|---|
| base (Qwen2.5-0.5B, untrained) | 54.3% | 80.3% | 0% | 13.3% | 10.0% | 45.8% | 0.66 |
| sft (`runs/sft`, bf16) | 99.7% | 100% | 0% | 98.3% | 100% | 68.1% | 1.22 (MPS) |

`results/base.json` and `results/sft.json` hold the per-case rows. The SFT checkpoint was
trained on 2026-08-23 and first evaluated on 2026-10-18 (an earlier run died at case 100). GKD and the Claude teacher ceiling have not
been run.

Read these numbers with care:

- The eval split is synthetic and in-distribution, and SFT saturates it. Claims about the
  student need a harder, out-of-distribution set first.
- This harness grades raw student output. The engine also pins the anchor fact and reconciles
  inherited facts verbatim, so production would grade the same student more leniently.
- Weights, `.venv/`, `data/` and the Claude-generated `teacher_train.jsonl` stay out of git.
  The training targets came from claude-sonnet-5, so check Anthropic's terms before publishing
  a checkpoint anywhere.

## Serving the student

The engine sends compile calls, and only those, to an OpenAI-compatible server when
`BONSAI_COMPILE_BASE_URL` and `BONSAI_COMPILE_MODEL` are set, for example Ollama serving
`runs/sft` at `http://localhost:11434/v1`. It is off by default and falls back to the normal
provider chain on any failure. Weights never go in git.

## Inside the Bonsai repo

This directory is not an npm workspace and nothing in the Next build imports it. The held-out
eval split is mirrored at [`evals/xl/eval.jsonl`](../../evals/xl/eval.jsonl), where
`npm run eval:xl` grades the engine's own compiler on it with a TypeScript port of
`checks.py`. Regenerate `data/` with `scripts/gen_data.py`; it is deterministic (seed 7).

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
