#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${DRAPIXAI_APP_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
REDIS_RUNTIME_DIR="${DRAPIXAI_REDIS_RUNTIME_DIR:-$APP_ROOT/runtime/redis}"

if [[ -z "${DRAPIXAI_REDIS_PASSWORD:-}" ]]; then
  echo "DRAPIXAI_REDIS_PASSWORD is required." >&2
  exit 1
fi
if sh "$APP_ROOT/deploy/scripts/private-redis.sh" health; then
  exit 0
fi

export DRAPIXAI_REDIS_RUNTIME_DIR="$REDIS_RUNTIME_DIR"
sh "$APP_ROOT/deploy/scripts/private-redis.sh" daemon

for _ in {1..30}; do
  if sh "$APP_ROOT/deploy/scripts/private-redis.sh" health; then
    exit 0
  fi
  sleep 1
done

echo "Redis failed to start on localhost." >&2
exit 1
