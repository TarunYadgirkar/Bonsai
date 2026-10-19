"""Student inference: any HF causal LM behind the same compile() signature the
teacher and eval use. Heavy deps import lazily so datagen/teacher run without torch."""
from __future__ import annotations

import time

from .prompts import COMPILER_SYSTEM, parse_compiler_output

DEFAULT_STUDENT = "Qwen/Qwen2.5-0.5B-Instruct"
SMOKE_STUDENT = "HuggingFaceTB/SmolLM2-135M-Instruct"


class StudentModel:
    def __init__(self, model_id: str = DEFAULT_STUDENT, adapter_path: str | None = None):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.model_id = model_id
        self.tokenizer = AutoTokenizer.from_pretrained(model_id, padding_side="left")
        device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        dtype = torch.bfloat16 if device != "cpu" else torch.float32
        self.model = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=dtype).to(device)
        if adapter_path:
            from peft import PeftModel

            self.model = PeftModel.from_pretrained(self.model, adapter_path)
        self.model.eval()
        self.device = device

    def compile(self, user_prompt: str) -> tuple[tuple[list[str], str] | None, dict]:
        """Returns (parsed_output, stats). stats: latency_s, output_tokens."""
        import torch

        chat = [
            {"role": "system", "content": COMPILER_SYSTEM},
            {"role": "user", "content": user_prompt},
        ]
        encoded = self.tokenizer.apply_chat_template(
            chat, add_generation_prompt=True, return_tensors="pt", return_dict=True
        )
        input_ids = encoded["input_ids"].to(self.device)
        attention_mask = encoded["attention_mask"].to(self.device)
        start = time.perf_counter()
        with torch.no_grad():
            out = self.model.generate(
                input_ids,
                attention_mask=attention_mask,
                max_new_tokens=600,
                do_sample=False,
                pad_token_id=self.tokenizer.pad_token_id or self.tokenizer.eos_token_id,
            )
        latency = time.perf_counter() - start
        generated = out[0][input_ids.shape[1] :]
        text = self.tokenizer.decode(generated, skip_special_tokens=True)
        return parse_compiler_output(text), {
            "latency_s": round(latency, 3),
            "output_tokens": int(generated.shape[0]),
        }
