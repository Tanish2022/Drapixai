#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
validator="$repo_root/deploy/scripts/validate-env.sh"

load_production_fixture() {
  set -a
  # shellcheck disable=SC1091
  source "$repo_root/deploy/env/ai.production.example"
  set +a
  export DRAPIXAI_REDIS_PASSWORD="$(printf 'r%.0s' {1..64})"
  export DRAPIXAI_ADMIN_TOKEN="$(printf 'a%.0s' {1..64})"
  export DRAPIXAI_AI_SERVICE_TOKEN="$(printf 's%.0s' {1..64})"
  export DRAPIXAI_AI_RELEASE_IMAGE="registry.example/drapixai/ai@sha256:$(printf '1%.0s' {1..64})"
}

load_reference_fixture() {
  load_production_fixture
  export DRAPIXAI_ENV="staging"
  export DRAPIXAI_GPU_PRESET="runpod-a100"
  export DRAPIXAI_ENABLE_XFORMERS="1"
  unset DRAPIXAI_AI_RELEASE_IMAGE
}

expect_pass() {
  local label="$1"
  shift
  if ! "$@" >/dev/null; then
    echo "FAIL: expected pass: $label" >&2
    exit 1
  fi
  echo "PASS: $label"
}

expect_fail() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL: expected rejection: $label" >&2
    exit 1
  fi
  echo "PASS: rejected $label"
}

production_valid() (
  load_production_fixture
  bash "$validator" ai
)

production_without_release_image() (
  load_production_fixture
  unset DRAPIXAI_AI_RELEASE_IMAGE
  bash "$validator" ai
)

reference_valid() (
  load_reference_fixture
  bash "$validator" ai-reference
)

reference_claiming_production() (
  load_reference_fixture
  export DRAPIXAI_ENV="production"
  bash "$validator" ai-reference
)

reference_with_persistent_spool() (
  load_reference_fixture
  export DRAPIXAI_TRANSIENT_SPOOL_DIR="$repo_root/runtime/tryon-spool"
  bash "$validator" ai-reference
)

expect_pass "production AI profile" production_valid
expect_fail "production AI profile without immutable release image" production_without_release_image
expect_pass "RunPod reference AI profile" reference_valid
expect_fail "RunPod reference profile claiming production" reference_claiming_production
expect_fail "RunPod reference profile using persistent shopper spool" reference_with_persistent_spool
