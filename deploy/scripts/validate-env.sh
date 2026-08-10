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
    replace-with-*|*RUNPOD_POD_IP*|*USERNAME:PASSWORD*|*your-api-key*|*your-product-id*)
      echo "Environment variable still contains a placeholder value: $name" >&2
      exit 1
      ;;
  esac
}

require_equals() {
  local name="$1"
  local expected="$2"
  local value="${!name:-}"
  if [[ "$value" != "$expected" ]]; then
    echo "Environment variable must be $expected: $name" >&2
    exit 1
  fi
}

require_not_equals() {
  local name="$1"
  local disallowed="$2"
  local value="${!name:-}"
  if [[ "$value" == "$disallowed" ]]; then
    echo "Environment variable has unsafe production value: $name=$disallowed" >&2
    exit 1
  fi
}

require_number_at_least() {
  local name="$1"
  local minimum="$2"
  local value="${!name:-}"
  python3 - "$name" "$value" "$minimum" <<'PY'
import sys

name, value, minimum = sys.argv[1], sys.argv[2], float(sys.argv[3])
try:
    parsed = float(value)
except ValueError:
    raise SystemExit(f"Environment variable must be numeric: {name}")
if parsed < minimum:
    raise SystemExit(f"Environment variable {name} must be at least {minimum:g}")
PY
}

require_min_length() {
  local name="$1"
  local minimum="$2"
  local value="${!name:-}"
  local length="${#value}"

  if (( length < minimum )); then
    echo "Environment variable must be at least $minimum characters: $name" >&2
    exit 1
  fi
}

require_pinned_pytorch_runtime_image() {
  local value="${DRAPIXAI_AI_RUNTIME_IMAGE:-}"
  if [[ ! "$value" =~ ^pytorch/pytorch:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$ ]]; then
    echo "DRAPIXAI_AI_RUNTIME_IMAGE must be a digest-pinned official pytorch/pytorch image." >&2
    exit 1
  fi
}

require_digest_pinned_release_image() {
  local name="$1"
  local value="${!name:-}"
  if [[ ! "$value" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
    echo "$name must be a digest-pinned immutable container image reference." >&2
    exit 1
  fi
}
require_base64_bytes() {
  local name="$1"
  local expected="$2"
  local value="${!name:-}"
  python3 - "$name" "$value" "$expected" <<'PY'
import base64
import sys

name, value, expected = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    decoded = base64.b64decode(value, validate=True)
except Exception:
    raise SystemExit(f"Environment variable must be valid base64: {name}")
if len(decoded) != expected:
    raise SystemExit(f"Environment variable {name} must decode to exactly {expected} bytes")
PY
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
      DRAPIXAI_AUTH_SYNC_TOKEN
      DRAPIXAI_DASHBOARD_PROXY_TOKEN
      DRAPIXAI_AI_URL
      DRAPIXAI_AI_SERVICE_TOKEN
      DRAPIXAI_CORS_ORIGINS
      DRAPIXAI_ADMIN_TOKEN
      DRAPIXAI_ADMIN_PASSWORD
      DRAPIXAI_ADMIN_TOTP_SECRET
      DRAPIXAI_STOREFRONT_TOKEN_SECRET
      DRAPIXAI_AUDIT_LOG_SECRET
      DRAPIXAI_API_ENVIRONMENT
      DRAPIXAI_WEBHOOK_ENCRYPTION_KEY
      DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION
      S3_BUCKET
      AWS_REGION
      DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY
      SMTP_HOST
      SMTP_PORT
      SMTP_USER
      SMTP_PASS
      SMTP_FROM
      DRAPIXAI_API_RELEASE_IMAGE
      DRAPIXAI_WEB_RELEASE_IMAGE
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
      DASHBOARD_SESSION_SECRET
      DRAPIXAI_AUTH_SYNC_TOKEN
      DRAPIXAI_DASHBOARD_PROXY_TOKEN
      DRAPIXAI_WEB_RELEASE_IMAGE
    )
    ;;
  ai)
    required_vars=(
      DRAPIXAI_ENV
      DRAPIXAI_GPU_PRESET
      DRAPIXAI_DEVICE
      DRAPIXAI_CUDA_DEVICE
      DRAPIXAI_REDIS_URL
      DRAPIXAI_REDIS_PASSWORD
      DRAPIXAI_TRYON_ENGINE
      DRAPIXAI_MODEL_DIR
      DRAPIXAI_CATVTON_MODEL_DIR
      DRAPIXAI_GARMENT_CACHE_DIR
      DRAPIXAI_ADMIN_TOKEN
      DRAPIXAI_AI_SERVICE_TOKEN
      DRAPIXAI_AI_RELEASE_IMAGE
    )
    if [[ "${DRAPIXAI_GARMENT_CACHE_BACKEND:-local}" == "s3" ]]; then
      required_vars+=(
        DRAPIXAI_S3_BUCKET
        DRAPIXAI_S3_REGION
        DRAPIXAI_S3_ACCESS_KEY_ID
        DRAPIXAI_S3_SECRET_ACCESS_KEY
      )
    fi
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
  require_equals NODE_ENV "production"
  require_min_length NEXTAUTH_SECRET 32
  require_min_length ADMIN_SESSION_SECRET 32
  require_min_length DASHBOARD_SESSION_SECRET 32
  require_min_length DRAPIXAI_AUTH_SYNC_TOKEN 32
  require_min_length DRAPIXAI_DASHBOARD_PROXY_TOKEN 32
  require_digest_pinned_release_image DRAPIXAI_WEB_RELEASE_IMAGE
  if [[ "${NEXT_PUBLIC_GOOGLE_AUTH_ENABLED:-0}" == "1" ]]; then
    require_var GOOGLE_CLIENT_ID
    require_var GOOGLE_CLIENT_SECRET
  fi
fi

if [[ "$profile" == "api" ]]; then
  require_equals NODE_ENV "production"
  require_min_length JWT_SECRET 32
  require_min_length DRAPIXAI_AUTH_SYNC_TOKEN 32
  require_min_length DRAPIXAI_DASHBOARD_PROXY_TOKEN 32
  require_digest_pinned_release_image DRAPIXAI_WEB_RELEASE_IMAGE
  require_min_length DRAPIXAI_AI_SERVICE_TOKEN 32
  require_min_length DRAPIXAI_ADMIN_TOKEN 32
  require_min_length DRAPIXAI_ADMIN_PASSWORD 12
  require_min_length DRAPIXAI_ADMIN_TOTP_SECRET 16
  require_min_length DRAPIXAI_STOREFRONT_TOKEN_SECRET 32
  require_min_length DRAPIXAI_AUDIT_LOG_SECRET 32
  if [[ "$DRAPIXAI_API_ENVIRONMENT" != "live" && "$DRAPIXAI_API_ENVIRONMENT" != "sandbox" ]]; then
    echo "DRAPIXAI_API_ENVIRONMENT must be live or sandbox" >&2
    exit 1
  fi
  require_base64_bytes DRAPIXAI_WEBHOOK_ENCRYPTION_KEY 32
  require_equals DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY "1"
  require_equals DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION "aws:kms"
  require_var DRAPIXAI_S3_KMS_KEY_ID
  if [[ "$DATABASE_URL" != *"sslmode=verify-full"* ]]; then
    echo "DATABASE_URL must set sslmode=verify-full" >&2
    exit 1
  fi
  if [[ "$REDIS_URL" != rediss://* ]]; then
    echo "REDIS_URL must use rediss:// in production" >&2
    exit 1
  fi
  if [[ -n "${S3_ENDPOINT:-}" && "$S3_ENDPOINT" != https://* ]]; then
    echo "S3_ENDPOINT must use https:// in production" >&2
    exit 1
  fi
  require_not_equals DRAPIXAI_CORS_ORIGINS "*"
  require_digest_pinned_release_image DRAPIXAI_API_RELEASE_IMAGE
  require_digest_pinned_release_image DRAPIXAI_WEB_RELEASE_IMAGE
  require_equals DRAPIXAI_REQUIRE_GARMENT_CACHE "1"
  require_equals DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER "0"
  require_equals DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK "0"
  require_equals DRAPIXAI_GARMENT_APPROVAL_REQUIRED "1"
  require_equals DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON "0"
  require_equals DRAPIXAI_SDK_GENERATION_SOURCE "original_verified"
  require_equals DRAPIXAI_AI_PRIVATE_NETWORK "1"
  require_equals DRAPIXAI_AI_MTLS_ENABLED "1"
  require_var DRAPIXAI_AI_MTLS_CERT_FILE
  require_var DRAPIXAI_AI_MTLS_KEY_FILE
  require_var DRAPIXAI_AI_ALLOWED_HOSTS
  ai_hostname="$(printf '%s' "$DRAPIXAI_AI_URL" | sed -E 's#^https://([^/:]+).*$#\1#' | tr '[:upper:]' '[:lower:]')"
  if [[ ",${DRAPIXAI_AI_ALLOWED_HOSTS,,}," != *",$ai_hostname,"* ]]; then
    echo "DRAPIXAI_AI_URL hostname must be listed in DRAPIXAI_AI_ALLOWED_HOSTS" >&2
    exit 1
  fi
  require_number_at_least DRAPIXAI_EXCELLENT_QUALITY_SCORE "0.95"
  require_number_at_least DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE "0.95"
  require_equals DRAPIXAI_AUTO_REJECT_BAD_RESULTS "1"
  require_equals DRAPIXAI_EXCELLENT_LATENCY_MS "10000"
  require_equals DRAPIXAI_MAX_PUBLISHABLE_LATENCY_MS "12000"
  require_equals DRAPIXAI_REVIEW_RETENTION_DAYS "0"
  require_equals DRAPIXAI_ENABLE_LOWER_BODY "0"
  if [[ "${DRAPIXAI_SHOPIFY_ENABLED:-0}" == "1" ]]; then
    for name in SHOPIFY_API_KEY SHOPIFY_API_SECRET DRAPIXAI_PUBLIC_API_BASE_URL DRAPIXAI_WEB_BASE_URL DRAPIXAI_SHOPIFY_STATE_SECRET DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY DRAPIXAI_STOREFRONT_TOKEN_SECRET; do
      require_var "$name"
      reject_placeholder "$name"
    done
    require_min_length SHOPIFY_API_KEY 16
    require_min_length SHOPIFY_API_SECRET 32
    require_min_length DRAPIXAI_SHOPIFY_STATE_SECRET 32
    require_base64_bytes DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY 32
    require_equals SHOPIFY_USE_LEGACY_INSTALL_FLOW "0"
    require_equals DRAPIXAI_SHOPIFY_AUTO_PREPARE "1"
    require_var DRAPIXAI_SHOPIFY_IMAGE_HOSTS
    require_not_equals DRAPIXAI_SHOPIFY_IMAGE_HOSTS "*"
  fi
fi

if [[ "$profile" == "ai" ]]; then
  require_min_length DRAPIXAI_REDIS_PASSWORD 32
  require_equals DRAPIXAI_ENV "production"
  require_min_length DRAPIXAI_AI_SERVICE_TOKEN 32
  require_min_length DRAPIXAI_ADMIN_TOKEN 32
  require_equals DRAPIXAI_TRYON_ENGINE "catvton"
  require_digest_pinned_release_image DRAPIXAI_AI_RELEASE_IMAGE
  if [[ "${DRAPIXAI_GPU_PRESET:-}" == "rtx-pro-6000-blackwell" ]]; then
    require_pinned_pytorch_runtime_image
    require_equals DRAPIXAI_ENABLE_XFORMERS "0"
  fi
  require_equals DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK "0"
  require_equals DRAPIXAI_CATVTON_MODEL_REVISION "2969fcf85fe62f2036605716f0b56f0b81d01d79"
  require_equals DRAPIXAI_CATVTON_GIT_COMMIT "7818397f25613beedb3d861a34769f607cfcf3b1"
  require_equals DRAPIXAI_CATVTON_BASE_REVISION "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb"
  require_equals DRAPIXAI_CATVTON_VAE_REVISION "31f26fdeee1355a5c34592e401dd41e45d25a493"
  require_var DRAPIXAI_CATVTON_BASE_MODEL
  require_var DRAPIXAI_CATVTON_VAE_MODEL
  require_equals DRAPIXAI_CANDIDATE_COUNT "1"
  require_number_at_least DRAPIXAI_MIN_QUALITY_SCORE "0.95"
  require_equals DRAPIXAI_GARMENT_CACHE_VERSION "v3-1024x1365"
  require_equals DRAPIXAI_GARMENT_TARGET_WIDTH "1024"
  require_equals DRAPIXAI_GARMENT_TARGET_HEIGHT "1365"
  require_equals DRAPIXAI_GARMENT_CONDITION_MAX_EDGE "1536"
  require_equals DRAPIXAI_ENABLE_FINAL_OUTPUT_UPSCALE "1"
  require_equals DRAPIXAI_OUTPUT_WIDTH "1024"
  require_equals DRAPIXAI_OUTPUT_HEIGHT "1365"
  require_equals DRAPIXAI_TRANSIENT_SPOOL_DIR "/dev/shm/drapixai-tryon-spool"
  require_equals DRAPIXAI_TRANSIENT_SPOOL_TTL "900"
fi

echo "Environment validation passed for profile: $profile"
