#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

export DRAPIXAI_REDIS_URL="${DRAPIXAI_REDIS_URL:-redis://127.0.0.1:6379/0}"
export REDISCLI_AUTH="${DRAPIXAI_REDIS_PASSWORD:-}"

RUNTIME_DIR="${DRAPIXAI_APP_ROOT}/runtime/run"
LOCK_FILE="${RUNTIME_DIR}/start-all.lock"
mkdir -p "$RUNTIME_DIR"

if ! command -v flock >/dev/null 2>&1; then
  echo "flock is required to guard the DrapixAI AI supervisor." >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "DrapixAI AI services are already supervised by another start-all process." >&2
  exit 1
fi

bash "$SCRIPT_DIR/../scripts/validate-env.sh" "$DRAPIXAI_AI_VALIDATION_PROFILE"

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
    bash "$SCRIPT_DIR/start-redis.sh"
  fi
fi

API_PID=""
WORKER_PID=""

cleanup() {
  local pid
  for pid in "$WORKER_PID" "$API_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$WORKER_PID" "$API_PID"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

bash "$SCRIPT_DIR/start-ai-api.sh" &
API_PID=$!

for attempt in {1..30}; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    wait "$API_PID" || true
    echo "AI API exited before becoming healthy on port ${PORT:-8080}." >&2
    exit 1
  fi
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null 2>&1; then
    echo "AI API is responding on port ${PORT:-8080}."
    break
  fi
  sleep 2
done

if ! kill -0 "$API_PID" 2>/dev/null || ! curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null 2>&1; then
  echo "AI API failed to become healthy on port ${PORT:-8080}." >&2
  exit 1
fi

bash "$SCRIPT_DIR/start-ai-worker.sh" &
WORKER_PID=$!

set +e
wait -n "$API_PID" "$WORKER_PID"
SERVICE_STATUS=$?
set -e

if [[ "$SERVICE_STATUS" -eq 0 ]]; then
  SERVICE_STATUS=1
fi

echo "A DrapixAI AI service exited unexpectedly; stopping the remaining service." >&2
exit "$SERVICE_STATUS"
