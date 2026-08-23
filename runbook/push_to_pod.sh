#!/usr/bin/env bash
# Runs ON THE MAC: tar repo (code + data, minus junk) and scp to the pod.
# Usage: bash runbook/push_to_pod.sh <pod-ip> <ssh-port>
set -euo pipefail
IP="${1:?usage: push_to_pod.sh <pod-ip> <ssh-port>}"
PORT="${2:?usage: push_to_pod.sh <pod-ip> <ssh-port>}"

cd "$(dirname "$0")/.."
tar czf /tmp/bonsai-distill.tgz \
  --exclude .venv --exclude runs --exclude results --exclude .git --exclude .env .
scp -P "$PORT" /tmp/bonsai-distill.tgz "root@$IP:/workspace/"
ssh -p "$PORT" "root@$IP" \
  "mkdir -p /workspace/bonsai-distill && tar xzf /workspace/bonsai-distill.tgz -C /workspace/bonsai-distill"
echo "shipped — next: ssh in, cd /workspace/bonsai-distill, bash runbook/bootstrap.sh"
