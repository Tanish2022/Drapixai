#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

if [[ "$DRAPIXAI_TRYON_ENGINE" == "catvton" ]]; then
  python "$DRAPIXAI_APP_ROOT/deploy/scripts/verify-model-artifacts.py" \
    "$DRAPIXAI_CATVTON_MODEL_DIR" "$DRAPIXAI_CATVTON_BASE_MODEL" "$DRAPIXAI_CATVTON_VAE_MODEL"
fi

export DRAPIXAI_REDIS_URL="${DRAPIXAI_REDIS_URL:-redis://127.0.0.1:6379/0}"

exec python -m drapixai_ai.worker.gpu_worker
