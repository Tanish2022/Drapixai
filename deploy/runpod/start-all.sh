#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

export DRAPIXAI_REDIS_URL="${DRAPIXAI_REDIS_URL:-redis://127.0.0.1:6379/0}"

bash "$SCRIPT_DIR/../scripts/validate-env.sh" ai

if [[ ! -d "$DRAPIXAI_MODEL_DIR" ]]; then
  echo "Model directory does not exist: $DRAPIXAI_MODEL_DIR" >&2
  exit 1
fi

if [[ "$DRAPIXAI_REDIS_URL" == "redis://127.0.0.1:6379/0" || "$DRAPIXAI_REDIS_URL" == "redis://localhost:6379/0" ]]; then
  if ! command -v redis-server >/dev/null 2>&1; then
    echo "redis-server is required when DRAPIXAI_REDIS_URL points to localhost." >&2
    exit 1
  fi
  if ! redis-cli ping >/dev/null 2>&1; then
    redis-server --daemonize yes
    sleep 2
  fi
fi

bash "$SCRIPT_DIR/start-ai-api.sh" &
API_PID=$!

for attempt in {1..30}; do
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null 2>&1; then
    echo "AI API is responding on port ${PORT:-8080}."
    break
  fi
  sleep 2
done

if ! curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null 2>&1; then
  echo "AI API failed to become healthy on port ${PORT:-8080}." >&2
  exit 1
fi

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

bash "$SCRIPT_DIR/start-ai-worker.sh"
