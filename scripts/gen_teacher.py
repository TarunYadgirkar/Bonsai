"""Generate gold briefs from the Claude teacher over the TRAIN split, rejection-sampled
through the entity checks. Usage: python scripts/gen_teacher.py [limit]

Needs ANTHROPIC_API_KEY. Writes data/teacher_train.jsonl (chat-format records) and
data/teacher_rejected.json (ids that never passed — audit these)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from bonsai_distill.schema import Example
from bonsai_distill.teacher import compile_all

data_dir = Path(__file__).parent.parent / "data"
examples = [
    Example.from_json(json.loads(line))
    for line in (data_dir / "examples_train.jsonl").read_text().splitlines()
]
limit = int(sys.argv[1]) if len(sys.argv) > 1 else len(examples)
examples = examples[:limit]


out_path = data_dir / "teacher_train.jsonl"
done_ids = set()
if out_path.exists():
    done_ids = {json.loads(line)["example_id"] for line in out_path.read_text().splitlines()}
    print(f"resuming — {len(done_ids)} examples already compiled")
examples = [e for e in examples if e.id not in done_ids]


def progress(done: int, total: int, kept: int, rejected: int) -> None:
    if done % 25 == 0 or done == total:
        print(f"{done}/{total} examples — {kept} records kept, {rejected} rejected")


with out_path.open("a") as f:

    def on_result(records: list[dict] | None, ex_id: str) -> None:
        for r in records or []:
            f.write(json.dumps(r) + "\n")
        f.flush()

    _, rejected_all = compile_all(examples, on_progress=progress, on_result=on_result)

(data_dir / "teacher_rejected.json").write_text(json.dumps(rejected_all, indent=2))
print(f"done ({len(rejected_all)} examples rejected this run)")
