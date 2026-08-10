#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  bash deploy/scripts/validate-production-env-set.sh [deploy/env]

Checks the production env files as a set so shared service secrets match
between API, web, and AI services. Run this after generating or editing:
  deploy/env/api.production.env
  deploy/env/web.production.env
  deploy/env/ai.production.env
EOF
  exit 1
}

[[ $# -le 1 ]] || usage

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_dir="${1:-$repo_root/deploy/env}"
api_env="$env_dir/api.production.env"
web_env="$env_dir/web.production.env"
ai_env="$env_dir/ai.production.env"

require_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Missing env file: $file" >&2
    exit 1
  fi
}

read_env_value() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*#" { next }
    index($0, key "=") == 1 {
      value = substr($0, length(key) + 2)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      gsub(/^\"|\"$/, "", value)
      gsub(/^'"'"'|'"'"'$/, "", value)
      print value
      found = 1
      exit
    }
    END { if (!found) exit 2 }
  ' "$file"
}

require_value() {
  local file="$1"
  local key="$2"
  local value
  if ! value="$(read_env_value "$file" "$key")"; then
    echo "Missing required key $key in $file" >&2
    exit 1
  fi
  if [[ -z "$value" ]]; then
    echo "Empty required key $key in $file" >&2
    exit 1
  fi
  case "$value" in
    replace-with-*|*RUNPOD_POD_IP*|*USERNAME:PASSWORD*)
      echo "Placeholder value for $key in $file" >&2
      exit 1
      ;;
  esac
  printf '%s' "$value"
}

require_digest_image() {
  local file="$1"
  local key="$2"
  local value
  value="$(require_value "$file" "$key")"
  if [[ ! "$value" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
    echo "Release image must be sha256-pinned: $key in $file" >&2
    exit 1
  fi
}

require_match() {
  local key="$1"
  local left_file="$2"
  local right_file="$3"
  local left_label="$4"
  local right_label="$5"
  local left right
  left="$(require_value "$left_file" "$key")"
  right="$(require_value "$right_file" "$key")"
  if [[ "$left" != "$right" ]]; then
    echo "Shared secret mismatch for $key between $left_label and $right_label" >&2
    exit 1
  fi
}

require_file "$api_env"
require_file "$web_env"
require_file "$ai_env"

require_match DRAPIXAI_AUTH_SYNC_TOKEN "$api_env" "$web_env" api web
require_match DRAPIXAI_DASHBOARD_PROXY_TOKEN "$api_env" "$web_env" api web
require_match DRAPIXAI_AI_SERVICE_TOKEN "$api_env" "$ai_env" api ai
require_match DRAPIXAI_ADMIN_TOKEN "$api_env" "$ai_env" api ai
require_match DRAPIXAI_WEB_RELEASE_IMAGE "$api_env" "$web_env" api web
require_digest_image "$api_env" DRAPIXAI_API_RELEASE_IMAGE
require_digest_image "$api_env" DRAPIXAI_WEB_RELEASE_IMAGE
require_digest_image "$ai_env" DRAPIXAI_AI_RELEASE_IMAGE

for env_file in "$api_env" "$web_env" "$ai_env"; do
  if ! git -C "$repo_root" check-ignore -q "$env_file"; then
    echo "Production env file must be ignored by Git: $env_file" >&2
    exit 1
  fi
done

echo "Production env set validation passed."
