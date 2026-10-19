"""Condition 2: off-policy SFT on teacher briefs.

Usage: python scripts/train_sft.py [--student MODEL_ID] [--out DIR] [--smoke]
Runs on a cloud GPU (or --smoke with SmolLM2-135M locally)."""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from bonsai_distill.student import DEFAULT_STUDENT, SMOKE_STUDENT

parser = argparse.ArgumentParser()
parser.add_argument("--student", default=DEFAULT_STUDENT)
parser.add_argument("--out", default="runs/sft")
parser.add_argument("--smoke", action="store_true")
parser.add_argument("--epochs", type=float, default=3)
parser.add_argument("--lr", type=float, default=2e-5)
args = parser.parse_args()
if args.smoke:
    args.student = SMOKE_STUDENT

import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM
from trl import SFTConfig, SFTTrainer

# transformers 5.x parallel weight loading segfaults on MPS when TRL loads from a
# path string — preload the model object instead
model = AutoModelForCausalLM.from_pretrained(args.student, dtype=torch.bfloat16)

data_path = str(Path(__file__).parent.parent / "data" / "teacher_train.jsonl")
dataset = load_dataset("json", data_files=data_path, split="train")
dataset = dataset.remove_columns([c for c in dataset.column_names if c != "messages"])
if args.smoke:
    dataset = dataset.select(range(min(32, len(dataset))))

config = SFTConfig(
    output_dir=args.out,
    num_train_epochs=args.epochs,
    learning_rate=args.lr,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    logging_steps=10,
    save_strategy="no",
    report_to=[],
    max_length=4096,
)
trainer = SFTTrainer(model=model, args=config, train_dataset=dataset)
trainer.train()
trainer.save_model(args.out)
print(f"saved to {args.out}")
