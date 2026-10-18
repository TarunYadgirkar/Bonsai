#!/usr/bin/env bash
# Runs ON THE POD from the repo root: deps -> SFT -> GKD x2 -> evals.
set -euo pipefail
export TOKENIZERS_PARALLELISM=false
export TRL_EXPERIMENTAL_SILENCE=1

JUDGE_FLAG=""
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  JUDGE_FLAG="--judge"
  echo "ANTHROPIC_API_KEY present — evals will run the downstream-QA judge"
else
  echo "no ANTHROPIC_API_KEY — evals run without the QA judge (re-runnable later)"
fi

echo "=== deps (pins matching the smoke-tested env; image torch kept) ==="
pip install -q "transformers==5.15.1" "trl==1.10.0" "datasets==5.0.1" \
  "accelerate==1.14.0" "peft==0.20.0" anthropic python-dotenv

run() { echo "=== $* ==="; time python "$@"; }

run scripts/train_sft.py --out runs/sft
run scripts/train_gkd.py --student runs/sft --teacher Qwen/Qwen2.5-7B-Instruct --out runs/gkd
run scripts/train_gkd.py --student runs/sft --teacher Qwen/Qwen2.5-7B-Instruct --pure-on-policy --out runs/gkd-op

run scripts/run_eval.py --model Qwen/Qwen2.5-0.5B-Instruct --name base $JUDGE_FLAG
run scripts/run_eval.py --model runs/sft --name sft $JUDGE_FLAG
run scripts/run_eval.py --model runs/gkd --name gkd $JUDGE_FLAG
run scripts/run_eval.py --model runs/gkd-op --name gkd-op $JUDGE_FLAG

echo "=== done — results/ ==="
ls -la results/
