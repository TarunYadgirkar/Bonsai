# RunPod runbook

Budget ceiling ~$15. A100 80GB on-demand (~$2/hr) → everything below fits in ~4–6h.
An A40/48GB also works (7B teacher in bf16 ≈ 15GB + 0.5B student + generation overhead);
prefer it if available at ~$0.8/hr.

## 1. Create pod (Tarun, in the RunPod console)

- Template: **RunPod PyTorch 2.4** (`runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04` or newer 2.x)
- GPU: 1× A100 80GB (or A40)
- Disk: 60GB volume
- Start, then copy the SSH command from the Connect tab (`ssh root@<ip> -p <port>`).

## 2. Ship code + data from the Mac

`data/*.jsonl` is gitignored, so tar — not git — is the transfer:

```bash
cd ~/TarunsCode/bonsai/research/distill
bash runbook/push_to_pod.sh <ip> <port>       # tars repo (minus .venv/runs) + scp
```

## 3. On the pod

```bash
cd /workspace/bonsai-distill
export ANTHROPIC_API_KEY=...    # optional — enables the downstream-QA judge in evals
bash runbook/bootstrap.sh
```

`bootstrap.sh` runs, in order (stage → rough wall-clock on A100):

| Stage | Command | Est. |
|---|---|---|
| deps | pip pins matching the smoked env (keeps image torch) | 5 min |
| SFT | `train_sft.py` (0.5B, 3 epochs, 2,324 records) | ~30 min |
| GKD | `train_gkd.py --student runs/sft` (7B teacher, 1 epoch, generation-heavy) | ~2 h |
| GKD pure on-policy | `train_gkd.py --student runs/sft --pure-on-policy` | ~2 h |
| evals | base / sft / gkd / gkd-op on the 300-example eval split | ~15 min each |

Results land in `results/*.json`. If the budget clock is running out, kill after the first
GKD variant — base/sft/gkd is already the core comparison; gkd-op is the bonus arm.

## 4. Pull results back to the Mac

```bash
scp -P <port> -r root@<ip>:/workspace/bonsai-distill/results ~/TarunsCode/bonsai/research/distill/
scp -P <port> -r root@<ip>:/workspace/bonsai-distill/runs ~/TarunsCode/bonsai/research/distill/   # checkpoints, ~4GB
```

Then **stop the pod** — on-demand bills while running.

## 5. Teacher ceiling (local, no GPU)

```bash
cd ~/TarunsCode/bonsai/research/distill
.venv/bin/python scripts/run_eval.py --teacher --name teacher --judge
```

## Known traps

- Pass model OBJECTS to TRL trainers, not path strings (transformers 5.x threaded
  loading segfaults on MPS; scripts already do this — don't revert).
- GKD requires student/teacher tokenizer identity — asserted at startup, fails fast.
- `TOKENIZERS_PARALLELISM=false` everywhere (bootstrap sets it).
- Every training record must end with an assistant turn (GKD collator) — teacher data
  already complies.
