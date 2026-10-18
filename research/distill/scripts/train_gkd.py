"""Condition 3: on-policy distillation (GKD) from an open teacher.

The open teacher must share the student's tokenizer (token-level KD requirement) —
asserted at startup. Default pairing: Qwen2.5-0.5B-Instruct student, Qwen2.5-7B-Instruct
teacher (14B on a cloud GPU via --teacher). Start from the SFT checkpoint (--student
runs/sft) so GKD is measured as the increment over off-policy, matching the paper setup.

Stack aligned with ~/TarunsCode/multi-teacher-kd: trl>=1.0 (GKD lives in
trl.experimental.gkd), conversational dataset format, GKD-paper defaults
lmbda=0.5 beta=0.5; --pure-on-policy sets lmbda=1.0 beta=1.0 (reverse KL).

Usage: python scripts/train_gkd.py [--student PATH_OR_ID] [--teacher ID] [--smoke]"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from bonsai_distill.student import DEFAULT_STUDENT, SMOKE_STUDENT

parser = argparse.ArgumentParser()
parser.add_argument("--student", default=DEFAULT_STUDENT)
parser.add_argument("--teacher", default="Qwen/Qwen2.5-7B-Instruct")
parser.add_argument("--out", default="runs/gkd")
parser.add_argument("--smoke", action="store_true")
parser.add_argument("--pure-on-policy", action="store_true")
parser.add_argument("--max-records", type=int, help="cap training records (local scaled-down runs)")
parser.add_argument("--epochs", type=float, default=1)
parser.add_argument("--lr", type=float, default=1e-5)
args = parser.parse_args()
if args.smoke:
    args.student, args.teacher = SMOKE_STUDENT, "HuggingFaceTB/SmolLM2-360M-Instruct"

import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl.experimental.gkd import GKDConfig, GKDTrainer

probe = "Branch brief — 55,000 dollars, September 11."
student_tok = AutoTokenizer.from_pretrained(args.student)
teacher_tok = AutoTokenizer.from_pretrained(args.teacher)
assert student_tok.encode(probe) == teacher_tok.encode(probe), (
    f"tokenizer mismatch: {args.student} vs {args.teacher} — token-level GKD requires a shared vocab"
)

# preload both models: transformers 5.x parallel weight loading segfaults on MPS when
# TRL loads from a path string
student_model = AutoModelForCausalLM.from_pretrained(args.student, dtype=torch.bfloat16)
teacher_model = AutoModelForCausalLM.from_pretrained(args.teacher, dtype=torch.bfloat16)

data_path = str(Path(__file__).parent.parent / "data" / "teacher_train.jsonl")
dataset = load_dataset("json", data_files=data_path, split="train")
dataset = dataset.remove_columns([c for c in dataset.column_names if c != "messages"])
if args.smoke:
    dataset = dataset.select(range(min(16, len(dataset))))
elif args.max_records:
    dataset = dataset.shuffle(seed=7).select(range(min(args.max_records, len(dataset))))

lmbda, beta = (1.0, 1.0) if args.pure_on_policy else (0.5, 0.5)
config = GKDConfig(
    output_dir=args.out,
    lmbda=lmbda,
    beta=beta,
    temperature=1.0,
    num_train_epochs=args.epochs,
    learning_rate=args.lr,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=8,
    logging_steps=10,
    save_strategy="no",
    report_to=[],
    max_length=4096,
)
trainer = GKDTrainer(
    model=student_model,
    teacher_model=teacher_model,
    args=config,
    train_dataset=dataset,
    processing_class=student_tok,
)
trainer.train()
trainer.save_model(args.out)
print(f"saved to {args.out}")
