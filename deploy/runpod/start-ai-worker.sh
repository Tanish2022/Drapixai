#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

export DRAPIXAI_REDIS_URL="${DRAPIXAI_REDIS_URL:-redis://127.0.0.1:6379/0}"

exec python -m drapixai_ai.worker.gpu_worker

