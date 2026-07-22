#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${DRAPIXAI_APP_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
REDIS_RUNTIME_DIR="${DRAPIXAI_REDIS_RUNTIME_DIR:-$APP_ROOT/runtime/redis}"

if [[ -z "${DRAPIXAI_REDIS_PASSWORD:-}" ]]; then
  echo "DRAPIXAI_REDIS_PASSWORD is required." >&2
  exit 1
fi
export REDISCLI_AUTH="$DRAPIXAI_REDIS_PASSWORD"

if redis-cli ping >/dev/null 2>&1; then
  exit 0
fi

mkdir -p "$REDIS_RUNTIME_DIR"
redis-server \
  --daemonize yes \
  --bind 127.0.0.1 \
  --protected-mode yes \
  --save "" \
  --appendonly no \
  --requirepass "$DRAPIXAI_REDIS_PASSWORD" \
  --dir "$REDIS_RUNTIME_DIR" \
  --dbfilename dump.rdb

for _ in {1..30}; do
  if redis-cli ping >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "Redis failed to start on localhost." >&2
exit 1
