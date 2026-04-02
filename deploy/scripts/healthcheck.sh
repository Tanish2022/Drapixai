#!/usr/bin/env bash
set -euo pipefail

check() {
  local name="$1"
  local url="$2"
  echo "==> ${name}: ${url}"
  curl --fail --silent --show-error "$url"
  echo
}

if [[ -n "${WEB_URL:-}" ]]; then
  check "web health" "${WEB_URL%/}/api/health"
fi

if [[ -n "${API_URL:-}" ]]; then
  check "api live" "${API_URL%/}/health"
  check "api ready" "${API_URL%/}/ready"
fi

if [[ -n "${AI_URL:-}" ]]; then
  check "ai live" "${AI_URL%/}/health"
  check "ai ready" "${AI_URL%/}/ready"
fi

