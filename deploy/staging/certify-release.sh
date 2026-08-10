#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
Usage:
  bash deploy/staging/certify-release.sh /run/secrets/drapixai-staging-certification.env

The environment file must remain outside Git and provide:
  DRAPIXAI_STAGING_CERTIFICATION_ENVIRONMENT=staging
  DRAPIXAI_STAGING_CERTIFICATION_API_URL=https://api.staging.example.com
  DRAPIXAI_EXPECTED_GIT_REF=<40-character release commit>
  DRAPIXAI_THREE_TENANT_MANIFEST=/secure/three-tenant-manifest.json

It may also provide the live security-boundary test variables documented in
`docs/security-release-gate.md`. This command does not retain result images.
EOF
  exit 2
}

[[ $# -eq 1 ]] || usage
certification_env="$1"
[[ -f "$certification_env" ]] || { echo "Missing certification environment file." >&2; exit 2; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 2; }
}
for command in git npm node python3 bash realpath; do
  require_command "$command"
done

set -a
source "$certification_env"
set +a

[[ "${DRAPIXAI_STAGING_CERTIFICATION_ENVIRONMENT:-}" == "staging" ]] || {
  echo "Refusing certification outside DRAPIXAI_STAGING_CERTIFICATION_ENVIRONMENT=staging." >&2
  exit 2
}
api_url="${DRAPIXAI_STAGING_CERTIFICATION_API_URL:-}"
[[ "$api_url" =~ ^https://[A-Za-z0-9.-]+/?$ ]] || {
  echo "DRAPIXAI_STAGING_CERTIFICATION_API_URL must be an HTTPS origin without a path." >&2
  exit 2
}
api_host="${api_url#https://}"
api_host="${api_host%/}"
[[ "$api_host" == *staging* && "$api_host" != "api.drapixai.com" ]] || {
  echo "Refusing certification against a non-staging API host." >&2
  exit 2
}

expected_ref="${DRAPIXAI_EXPECTED_GIT_REF:-}"
[[ "$expected_ref" =~ ^[a-f0-9]{40}$ ]] || {
  echo "DRAPIXAI_EXPECTED_GIT_REF must be an exact 40-character release commit." >&2
  exit 2
}
current_commit="$(git -C "$repo_root" rev-parse HEAD)"
expected_commit="$(git -C "$repo_root" rev-parse "${expected_ref}^{commit}" 2>/dev/null || true)"
[[ -n "$expected_commit" && "$expected_commit" == "$current_commit" ]] || {
  echo "Checkout does not match DRAPIXAI_EXPECTED_GIT_REF." >&2
  exit 1
}
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] || {
  echo "Staging certification requires a clean release checkout." >&2
  exit 1
}

manifest="${DRAPIXAI_THREE_TENANT_MANIFEST:-}"
[[ -f "$manifest" ]] || {
  echo "DRAPIXAI_THREE_TENANT_MANIFEST must point to a local, token-free three-tenant manifest." >&2
  exit 2
}

required_live_vars=(
  DRAPIXAI_SECURITY_TEST_API_URL
  DRAPIXAI_SECURITY_TEST_SERVER_KEY_A
  DRAPIXAI_SECURITY_TEST_SHOPPER_TOKEN_A
  DRAPIXAI_SECURITY_TEST_EXPIRED_SHOPPER_TOKEN_A
  DRAPIXAI_SECURITY_TEST_PRODUCT_A
  DRAPIXAI_SECURITY_TEST_PRODUCT_B
  DRAPIXAI_SECURITY_TEST_RESULT_B
  DRAPIXAI_SECURITY_TEST_ORIGIN_A
  DRAPIXAI_SECURITY_TEST_PUBLIC_API_TOKEN_A
  DRAPIXAI_SECURITY_TEST_RATE_LIMIT_PATH
  DRAPIXAI_SECURITY_TEST_RATE_LIMIT_ATTEMPTS
  DRAPIXAI_SECURITY_TEST_ENVIRONMENT
)
for name in "${required_live_vars[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "Missing required live-security variable: $name" >&2; exit 2; }
done
[[ "$DRAPIXAI_SECURITY_TEST_ENVIRONMENT" == "staging" ]] || {
  echo "Live security harness must be set to staging." >&2
  exit 2
}
[[ "$DRAPIXAI_SECURITY_TEST_API_URL" == "$api_url" ]] || {
  echo "Live security API URL must exactly match the staging certification API URL." >&2
  exit 2
}

run_id="$(date -u +%Y%m%dT%H%M%SZ)-${current_commit:0:12}"
evidence_root="${DRAPIXAI_STAGING_CERTIFICATION_OUTPUT_DIR:-$repo_root/runtime/launch-evidence/staging-certification/$run_id}"
mkdir -p "$evidence_root"
evidence_root="$(realpath "$evidence_root")"
allowed_root="$(realpath -m "$repo_root/runtime/launch-evidence")"
case "$evidence_root/" in
  "$allowed_root"/*) ;;
  *) echo "Certification evidence must remain under runtime/launch-evidence." >&2; exit 2 ;;
esac
chmod 700 "$evidence_root"

run_and_record() {
  local label="$1"
  shift
  echo "Running $label"
  "$@" >"$evidence_root/$label.out" 2>"$evidence_root/$label.err"
}

run_and_record topology python3 "$repo_root/deploy/scripts/verify-staging-topology.py"
run_and_record private-listeners bash "$repo_root/deploy/scripts/verify-private-listeners.sh"
run_and_record live-security npm --prefix "$repo_root/apps/api" run test:security:live
run_and_record audit-chain npm --prefix "$repo_root/apps/api" run security:audit:verify
run_and_record shopper-media-privacy npm --prefix "$repo_root/apps/api" run privacy:verify-shopper-media
run_and_record three-tenant-public-api python3 "$repo_root/deploy/scripts/benchmark-three-tenant-public-api.py" \
  --manifest "$manifest" \
  --base-url "$api_url/v1" \
  --output-dir "$evidence_root/three-tenant-public-api"

cat >"$evidence_root/summary.json" <<EOF
{
  "status": "PASS",
  "release_commit": "$current_commit",
  "environment": "staging",
  "api_origin": "$api_url",
  "output_images_retained": false,
  "evidence_directory": "$evidence_root",
  "completed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "Staging certification passed. Review redacted artifacts in: $evidence_root"
echo "Record each reviewed artifact using scripts/record-launch-evidence.mjs; do not copy credentials, raw request bodies, or images into the release record."