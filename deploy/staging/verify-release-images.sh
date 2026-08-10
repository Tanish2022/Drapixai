#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  bash deploy/staging/verify-release-images.sh <edge|ai> [deploy/staging/.images.env] [40-character-commit]

Proves that running staging application containers use the exact sha256-pinned
release images and OCI revision label from the approved release artifact record.
EOF
  exit 2
}

[[ $# -ge 1 && $# -le 3 ]] || usage
role="$1"
[[ "$role" == "edge" || "$role" == "ai" ]] || usage
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
images_env="${2:-$repo_root/deploy/staging/.images.env}"
[[ -f "$images_env" ]] || { echo "Missing staging images env file: $images_env" >&2; exit 2; }

set -a
source "$images_env"
set +a
expected_commit="${3:-${DRAPIXAI_RELEASE_COMMIT:-}}"
[[ "$expected_commit" =~ ^[a-f0-9]{40}$ ]] || {
  echo "Expected release commit must be a 40-character lowercase Git commit." >&2
  exit 2
}
[[ "${DRAPIXAI_RELEASE_COMMIT:-}" == "$expected_commit" ]] || {
  echo "DRAPIXAI_RELEASE_COMMIT does not match the expected release commit." >&2
  exit 1
}

compose_file="$repo_root/deploy/staging/docker-compose.$role.yml"
case "$role" in
  edge)
    services=(api web)
    variables=(DRAPIXAI_API_RELEASE_IMAGE DRAPIXAI_WEB_RELEASE_IMAGE)
    ;;
  ai)
    services=(ai-api ai-worker)
    variables=(DRAPIXAI_AI_RELEASE_IMAGE DRAPIXAI_AI_RELEASE_IMAGE)
    ;;
esac

for index in "${!services[@]}"; do
  service="${services[$index]}"
  variable="${variables[$index]}"
  expected_image="${!variable:-}"
  [[ "$expected_image" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || {
    echo "$variable must be a sha256-pinned release image." >&2
    exit 1
  }
  container_id="$(docker compose --env-file "$images_env" -f "$compose_file" ps -q "$service")"
  [[ -n "$container_id" ]] || {
    echo "Staging service is not running: $service" >&2
    exit 1
  }
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  [[ "$actual_image" == "$expected_image" ]] || {
    echo "Staging service $service is not running the expected release image." >&2
    exit 1
  }
  revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$actual_image")"
  [[ "$revision" == "$expected_commit" ]] || {
    echo "Staging service $service image revision does not match the expected release commit." >&2
    exit 1
  }
done

echo "PASS: Staging $role services use expected release image digests and revision $expected_commit"