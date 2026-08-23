"""Generate the synthetic corpus. Usage: python scripts/gen_data.py [n_train] [n_eval]"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from bonsai_distill.datagen import generate

n_train = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
n_eval = int(sys.argv[2]) if len(sys.argv) > 2 else 300

examples = generate(n_train, n_eval)
data_dir = Path(__file__).parent.parent / "data"
data_dir.mkdir(exist_ok=True)

for split in ("train", "eval"):
    rows = [e for e in examples if e.split == split]
    path = data_dir / f"examples_{split}.jsonl"
    with path.open("w") as f:
        for e in rows:
            f.write(json.dumps(e.to_json()) + "\n")
    fams = Counter(e.family for e in rows)
    print(f"{path.name}: {len(rows)} examples — {dict(fams)}")
