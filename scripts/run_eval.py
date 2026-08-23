"""Grade a condition on the eval split.

Usage:
  python scripts/run_eval.py --model Qwen/Qwen2.5-0.5B-Instruct --name base
  python scripts/run_eval.py --model runs/sft --name sft
  python scripts/run_eval.py --model runs/gkd --name gkd
  python scripts/run_eval.py --teacher --name teacher          # Claude ceiling
Add --judge to run downstream QA (needs ANTHROPIC_API_KEY), --limit N for a subset.
Writes results/<name>.json (per-case rows + summary)."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from bonsai_distill.evaluate import ClaudeJudge, eval_example, summarize
from bonsai_distill.schema import Example

parser = argparse.ArgumentParser()
parser.add_argument("--model", help="HF model id or local checkpoint dir")
parser.add_argument("--teacher", action="store_true", help="eval the Claude teacher instead")
parser.add_argument("--name", required=True)
parser.add_argument("--judge", action="store_true")
parser.add_argument("--limit", type=int)
args = parser.parse_args()

root = Path(__file__).parent.parent
examples = [
    Example.from_json(json.loads(line))
    for line in (root / "data" / "examples_eval.jsonl").read_text().splitlines()
]
if args.limit:
    examples = examples[: args.limit]

if args.teacher:
    import time

    import anthropic

    from bonsai_distill.teacher import compile_once

    client = anthropic.Anthropic()

    def compile_fn(user_prompt):
        start = time.perf_counter()
        parsed = compile_once(client, user_prompt)
        return parsed, {"latency_s": round(time.perf_counter() - start, 3), "output_tokens": 0}

else:
    from bonsai_distill.student import StudentModel

    student = StudentModel(args.model)
    compile_fn = student.compile

judge = ClaudeJudge() if args.judge else None
results = []
for i, ex in enumerate(examples):
    results.append(eval_example(ex, compile_fn, judge))
    if (i + 1) % 20 == 0:
        print(f"{i + 1}/{len(examples)}")

summary = summarize(results)
out_dir = root / "results"
out_dir.mkdir(exist_ok=True)
(out_dir / f"{args.name}.json").write_text(json.dumps({"summary": summary, "cases": results}, indent=2))
print(json.dumps(summary, indent=2))
