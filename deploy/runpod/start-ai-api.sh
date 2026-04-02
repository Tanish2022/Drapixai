#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

export DRAPIXAI_REDIS_URL="${DRAPIXAI_REDIS_URL:-redis://127.0.0.1:6379/0}"
export PORT="${PORT:-8080}"

exec python -m uvicorn drapixai_ai.api.ai_server:app --host 0.0.0.0 --port "$PORT"

