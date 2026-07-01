#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${API_URL:-}" ]]; then
  echo "Set API_URL before running prove-live-stack.sh" >&2
  exit 1
fi

json_assert() {
  local label="$1"
  local path="$2"
  local expected_json="$3"
  python3 -c '
import json
import sys

label, path, expected_json = sys.argv[1], sys.argv[2], sys.argv[3]
data = json.load(sys.stdin)
expected = json.loads(expected_json)
actual = data
for part in path.split("."):
    if not isinstance(actual, dict) or part not in actual:
        raise SystemExit(f"{label} failed: missing {path}\nPayload: {json.dumps(data, indent=2)}")
    actual = actual[part]
if actual != expected:
    raise SystemExit(f"{label} failed: {path} expected {expected!r}, got {actual!r}\nPayload: {json.dumps(data, indent=2)}")
print(f"{label}: ok")
' "$label" "$path" "$expected_json"
}
read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

resolve_dashboard_proxy_token() {
  local token="${DRAPIXAI_DASHBOARD_PROXY_TOKEN:-${DASHBOARD_PROXY_TOKEN:-}}"
  if [[ -n "$token" ]]; then
    printf '%s' "$token"
    return
  fi

  local candidate_files=()
  if [[ -n "${DRAPIXAI_API_ENV_FILE:-${API_ENV_FILE:-}}" ]]; then
    candidate_files+=("${DRAPIXAI_API_ENV_FILE:-${API_ENV_FILE:-}}")
  fi
  candidate_files+=("apps/api/.env" "deploy/env/api.production.env")

  local file value
  for file in "${candidate_files[@]}"; do
    value="$(read_env_value DRAPIXAI_DASHBOARD_PROXY_TOKEN "$file")"
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi
  done
}
fetch_json() {
  local url="$1"
  curl --fail --silent --show-error "$url"
}

echo "==> API health"
api_health="$(fetch_json "${API_URL%/}/health")"
printf '%s' "$api_health" | json_assert "api /health" "status" '"ok"'

echo "==> API readiness proves API -> DB -> Redis -> AI"
api_ready="$(fetch_json "${API_URL%/}/ready")"
printf '%s' "$api_ready" | json_assert "api /ready status" "status" '"ready"'
printf '%s' "$api_ready" | json_assert "database ready" "checks.database.ready" 'true'
printf '%s' "$api_ready" | json_assert "redis ready" "checks.redis" 'true'
printf '%s' "$api_ready" | json_assert "ai ready through api" "checks.ai.status" '"ready"'

if [[ -n "${AI_URL:-}" ]]; then
  echo "==> Direct AI readiness"
  ai_health="$(fetch_json "${AI_URL%/}/health")"
  printf '%s' "$ai_health" | json_assert "ai /health" "status" '"ok"'
  ai_ready="$(fetch_json "${AI_URL%/}/ready")"
  printf '%s' "$ai_ready" | json_assert "ai /ready" "status" '"ready"'
fi

if [[ -n "${WEB_URL:-}" ]]; then
  echo "==> Web health"
  web_health="$(fetch_json "${WEB_URL%/}/api/health")"
  printf '%s' "$web_health" | json_assert "web /api/health" "status" '"ok"'
fi

if [[ -n "${PERSON_IMAGE:-}" && -n "${CLOTH_IMAGE:-}" ]]; then
  echo "==> Running cached SDK smoke flow"
  dashboard_proxy_token="$(resolve_dashboard_proxy_token)"
  if [[ -z "$dashboard_proxy_token" ]]; then
    echo "DASHBOARD_PROXY_TOKEN/DRAPIXAI_DASHBOARD_PROXY_TOKEN was not found; hardened production APIs will reject SDK management setup calls." >&2
  fi
  DASHBOARD_PROXY_TOKEN="$dashboard_proxy_token" bash "$(dirname "${BASH_SOURCE[0]}")/smoke-test.sh"
else
  echo "Skipping SDK image try-on. Set PERSON_IMAGE and CLOTH_IMAGE to prove the full cached generation path."
fi

echo "Live stack proof completed."
