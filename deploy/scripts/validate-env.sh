#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  bash deploy/scripts/validate-env.sh <api|web|ai>

This script validates the currently exported environment variables.
Source the relevant env file first, then run this script.
EOF
  exit 1
}

[[ $# -eq 1 ]] || usage

profile="$1"

require_var() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

reject_placeholder() {
  local name="$1"
  local value="${!name:-}"

  [[ -z "$value" ]] && return 0

  case "$value" in
    replace-with-a-long-random-secret|http://RUNPOD_POD_IP:8080|postgresql://USERNAME:PASSWORD@HOST:5432/drapixai)
      echo "Environment variable still contains a placeholder value: $name" >&2
      exit 1
      ;;
  esac
}

require_pair_or_none() {
  local first="$1"
  local second="$2"
  local first_value="${!first:-}"
  local second_value="${!second:-}"

  if [[ -n "$first_value" && -z "$second_value" ]]; then
    echo "Environment variables must be set together: $first and $second" >&2
    exit 1
  fi

  if [[ -z "$first_value" && -n "$second_value" ]]; then
    echo "Environment variables must be set together: $first and $second" >&2
    exit 1
  fi
}

case "$profile" in
  api)
    required_vars=(
      DATABASE_URL
      REDIS_URL
      JWT_SECRET
      DRAPIXAI_AI_URL
      DRAPIXAI_CORS_ORIGINS
      DRAPIXAI_ADMIN_TOKEN
      DRAPIXAI_ADMIN_PASSWORD
      S3_BUCKET
      AWS_REGION
      AWS_ACCESS_KEY_ID
      AWS_SECRET_ACCESS_KEY
      SMTP_HOST
      SMTP_PORT
      SMTP_USER
      SMTP_PASS
      SMTP_FROM
    )
    ;;
  web)
    required_vars=(
      NEXT_PUBLIC_WEB_BASE_URL
      NEXT_PUBLIC_API_BASE_URL
      DRAPIXAI_API_URL
      NEXTAUTH_URL
      NEXTAUTH_SECRET
      ADMIN_SESSION_SECRET
    )
    ;;
  ai)
    required_vars=(
      DRAPIXAI_GPU_PRESET
      DRAPIXAI_DEVICE
      DRAPIXAI_CUDA_DEVICE
      DRAPIXAI_REDIS_URL
      DRAPIXAI_TRYON_ENGINE
      DRAPIXAI_MODEL_DIR
      DRAPIXAI_CATVTON_MODEL_DIR
      DRAPIXAI_GARMENT_CACHE_DIR
      DRAPIXAI_ADMIN_TOKEN
      DRAPIXAI_S3_BUCKET
      DRAPIXAI_S3_REGION
      DRAPIXAI_S3_ACCESS_KEY_ID
      DRAPIXAI_S3_SECRET_ACCESS_KEY
    )
    ;;
  *)
    usage
    ;;
esac

for name in "${required_vars[@]}"; do
  require_var "$name"
  reject_placeholder "$name"
done

require_pair_or_none GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET

if [[ "$profile" == "web" ]]; then
  if [[ "${NEXT_PUBLIC_GOOGLE_AUTH_ENABLED:-0}" == "1" ]]; then
    require_var GOOGLE_CLIENT_ID
    require_var GOOGLE_CLIENT_SECRET
  fi
fi

echo "Environment validation passed for profile: $profile"
