#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  DRAPIXAI_EXPECTED_GIT_REF=<40-character-release-commit> \
  bash deploy/scripts/start-production-release.sh <edge|ai> [deploy/env]

Starts only previously scanned, digest-pinned release artifacts. It never builds
application code. The matching immutable image variables must be present in the
ignored production environment file(s).
EOF
  exit 2
}

[[ $# -ge 1 && $# -le 2 ]] || usage
role="$1"
[[ "$role" == "edge" || "$role" == "ai" ]] || usage
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_dir="${2:-$repo_root/deploy/env}"

require_file() {
  [[ -f "$1" ]] || { echo "Missing production environment file: $1" >&2; exit 1; }
}
require_digest_image() {
  local name="$1"
  local image="${!name:-}"
  [[ "$image" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || {
    echo "$name must be an immutable registry image reference pinned by sha256." >&2
    exit 1
  }
}

expected_ref="${DRAPIXAI_EXPECTED_GIT_REF:-}"
[[ "$expected_ref" =~ ^[a-f0-9]{40}$ ]] || { echo "DRAPIXAI_EXPECTED_GIT_REF must be an exact release commit." >&2; exit 1; }
expected_commit="$(git -C "$repo_root" rev-parse "${expected_ref}^{commit}" 2>/dev/null || true)"
current_commit="$(git -C "$repo_root" rev-parse HEAD)"
[[ -n "$expected_commit" && "$expected_commit" == "$current_commit" ]] || { echo "Checkout does not match DRAPIXAI_EXPECTED_GIT_REF." >&2; exit 1; }
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] || { echo "Production checkout must be clean." >&2; exit 1; }

if [[ "$role" == "edge" ]]; then
  api_env="$env_dir/api.production.env"
  web_env="$env_dir/web.production.env"
  require_file "$api_env"
  require_file "$web_env"
  set -a
  source "$api_env"
  set +a
  bash "$repo_root/deploy/scripts/validate-env.sh" api
  set -a
  source "$web_env"
  set +a
  bash "$repo_root/deploy/scripts/validate-env.sh" web
  bash "$repo_root/deploy/scripts/validate-production-env-set.sh" "$env_dir"
  require_digest_image DRAPIXAI_API_RELEASE_IMAGE
  require_digest_image DRAPIXAI_WEB_RELEASE_IMAGE
  docker compose --env-file "$api_env" -f "$repo_root/deploy/docker-compose.edge.yml" pull
  docker compose --env-file "$api_env" -f "$repo_root/deploy/docker-compose.edge.yml" up -d --no-build --remove-orphans
else
  ai_env="$env_dir/ai.production.env"
  require_file "$ai_env"
  set -a
  source "$ai_env"
  set +a
  bash "$repo_root/deploy/scripts/validate-env.sh" ai
  require_digest_image DRAPIXAI_AI_RELEASE_IMAGE
  docker compose --env-file "$ai_env" -f "$repo_root/deploy/docker-compose.ai.yml" pull redis ai-api ai-worker
  docker compose --env-file "$ai_env" -f "$repo_root/deploy/docker-compose.ai.yml" up -d --no-build redis ai-api ai-worker
fi

echo "Started $role production services from immutable release artifacts at commit $current_commit."
