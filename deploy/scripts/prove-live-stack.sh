#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${API_URL:-}" ]]; then
  echo "Set API_URL before running prove-live-stack.sh" >&2
  exit 1
fi

json_assert() {
  local label="$1"
  local expression="$2"
  python3 -c '
import json
import sys

label, expression = sys.argv[1], sys.argv[2]
data = json.load(sys.stdin)
scope = {"data": data}
if not bool(eval(expression, {"__builtins__": {}}, scope)):
    raise SystemExit(f"{label} failed: {expression}\nPayload: {json.dumps(data, indent=2)}")
print(f"{label}: ok")
' "$label" "$expression"
}

fetch_json() {
  local url="$1"
  curl --fail --silent --show-error "$url"
}

echo "==> API health"
api_health="$(fetch_json "${API_URL%/}/health")"
printf '%s' "$api_health" | json_assert "api /health" "data.get('status') == 'ok'"

echo "==> API readiness proves API -> DB -> Redis -> AI"
api_ready="$(fetch_json "${API_URL%/}/ready")"
printf '%s' "$api_ready" | json_assert "api /ready status" "data.get('status') == 'ready'"
printf '%s' "$api_ready" | json_assert "database ready" "data.get('checks', {}).get('database', {}).get('ready') is True"
printf '%s' "$api_ready" | json_assert "redis ready" "data.get('checks', {}).get('redis') is True"
printf '%s' "$api_ready" | json_assert "ai ready through api" "data.get('checks', {}).get('ai', {}).get('status') == 'ready'"

if [[ -n "${AI_URL:-}" ]]; then
  echo "==> Direct AI readiness"
  ai_health="$(fetch_json "${AI_URL%/}/health")"
  printf '%s' "$ai_health" | json_assert "ai /health" "data.get('status') == 'ok'"
  ai_ready="$(fetch_json "${AI_URL%/}/ready")"
  printf '%s' "$ai_ready" | json_assert "ai /ready" "data.get('status') == 'ready'"
fi

if [[ -n "${WEB_URL:-}" ]]; then
  echo "==> Web health"
  web_health="$(fetch_json "${WEB_URL%/}/api/health")"
  printf '%s' "$web_health" | json_assert "web /api/health" "data.get('status') == 'ok'"
fi

if [[ -n "${PERSON_IMAGE:-}" && -n "${CLOTH_IMAGE:-}" ]]; then
  echo "==> Running cached SDK smoke flow"
  bash "$(dirname "${BASH_SOURCE[0]}")/smoke-test.sh"
else
  echo "Skipping SDK image try-on. Set PERSON_IMAGE and CLOTH_IMAGE to prove the full cached generation path."
fi

echo "Live stack proof completed."
