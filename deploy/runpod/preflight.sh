#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ENV_FILE="${1:-$DRAPIXAI_APP_ROOT/deploy/env/ai.production.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

bash "$SCRIPT_DIR/../scripts/validate-env.sh" ai

echo "== GPU =="
nvidia-smi || true

echo
echo "== Python =="
python --version

echo
echo "== Disk =="
df -h "$DRAPIXAI_APP_ROOT" || true

echo
echo "== Key Paths =="
echo "APP_ROOT=$DRAPIXAI_APP_ROOT"
echo "MODEL_DIR=$DRAPIXAI_MODEL_DIR"
echo "GARMENT_CACHE_DIR=$DRAPIXAI_GARMENT_CACHE_DIR"
echo "HF_HOME=$HF_HOME"
echo "TORCH_HOME=$TORCH_HOME"
echo "U2NET_HOME=$U2NET_HOME"

[[ -d "$DRAPIXAI_MODEL_DIR" ]] || { echo "Missing model directory: $DRAPIXAI_MODEL_DIR" >&2; exit 1; }
[[ -f "$DRAPIXAI_MODEL_DIR/model_index.json" ]] || { echo "Missing model_index.json under $DRAPIXAI_MODEL_DIR" >&2; exit 1; }

echo
echo "== Torch / CUDA =="
python - <<'PY'
import torch
print(f"torch={torch.__version__}")
print(f"cuda_available={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"cuda_device_count={torch.cuda.device_count()}")
    print(f"cuda_device_name={torch.cuda.get_device_name(0)}")
PY

echo
echo "== Redis target =="
echo "$DRAPIXAI_REDIS_URL"

echo
echo "Preflight passed. Next:"
echo "1. bash deploy/runpod/start-all.sh"
echo "2. curl http://127.0.0.1:8080/health"
echo "3. curl http://127.0.0.1:8080/ready"
