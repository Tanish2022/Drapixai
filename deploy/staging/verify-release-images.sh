#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  bash deploy/staging/verify-release-images.sh <cpu|edge|ai> [deploy/staging/.images.env] [40-character-commit]

Proves that running staging application containers use the exact sha256-pinned
release images and OCI revision label from the approved release artifact record.
EOF
  exit 2
}

[[ $# -ge 1 && $# -le 3 ]] || usage
role="$1"
[[ "$role" == "cpu" || "$role" == "edge" || "$role" == "ai" ]] || usage
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

compose_args=(--env-file "$images_env" -f "$repo_root/deploy/staging/docker-compose.$role.yml")
case "$role" in
  cpu)
    compose_args=(--env-file "$images_env" -f "$repo_root/deploy/staging/docker-compose.edge.yml" -f "$repo_root/deploy/staging/docker-compose.neon-cpu.yml")
    services=(api web redis)
    variables=(DRAPIXAI_API_RELEASE_IMAGE DRAPIXAI_WEB_RELEASE_IMAGE DRAPIXAI_REDIS_IMAGE)
    ;;
  edge)
    services=(api web)
    variables=(DRAPIXAI_API_RELEASE_IMAGE DRAPIXAI_WEB_RELEASE_IMAGE)
    ;;
  ai)
    services=(ai-api ai-worker)
    variables=(DRAPIXAI_AI_RELEASE_IMAGE DRAPIXAI_AI_RELEASE_IMAGE)
    ;;
esac

service_identities=""
for index in "${!services[@]}"; do
  service="${services[$index]}"
  variable="${variables[$index]}"
  expected_image="${!variable:-}"
  [[ "$expected_image" =~ ^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || {
    echo "$variable must be a sha256-pinned release image." >&2
    exit 1
  }
  container_id="$(docker compose "${compose_args[@]}" ps -q "$service")"
  [[ -n "$container_id" ]] || {
    echo "Staging service is not running: $service" >&2
    exit 1
  }
  actual_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  [[ "$actual_image" == "$expected_image" ]] || {
    echo "Staging service $service is not running the expected release image." >&2
    exit 1
  }
  revision_source="$actual_image"
  if [[ "$role" == cpu ]]; then
    expected_id="$(docker image inspect --format '{{.Id}}' "$expected_image")"
    running_id="$(docker inspect --format '{{.Image}}' "$container_id")"
    [[ "$running_id" =~ ^sha256:[a-f0-9]{64}$ && "$expected_id" == "$running_id" && "$(docker inspect --format '{{.State.Running}}' "$container_id")" == true ]] || {
      echo "Running image identity mismatch for $service." >&2
      exit 1
    }
    revision_source="$running_id"
  fi
  revision=""
  if [[ "$service" != redis ]]; then
    revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$revision_source")"
    [[ "$revision" == "$expected_commit" ]] || { echo "Revision mismatch for $service." >&2; exit 1; }
  fi
  if [[ "$role" == cpu ]]; then
    docker inspect "$container_id" | python3 "$repo_root/deploy/staging/check-cpu-container.py" "$service"
    if [[ "$service" == api ]]; then
      project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container_id")"
      postgres_ids="$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=postgres)"
      [[ -n "$project" && -z "$postgres_ids" ]] || { echo "Unexpected local PostgreSQL service." >&2; exit 1; }
    fi
  fi
  # The service names, digest references and revision have restricted alphabets,
  # so they can safely form the versioned JSON evidence without shell escaping.
  [[ -z "$service_identities" ]] || service_identities+=","
  identity="\"image\":\"$actual_image\",\"revision\":\"$revision\""
  if [[ "$role" == cpu ]]; then identity+=",\"image_id\":\"$running_id\""; fi
  service_identities+="\"$service\":{$identity}"
done

printf 'DRAPIXAI_RELEASE_IMAGE_EVIDENCE_V1={"schema_version":1,"role":"%s","release_commit":"%s","services":{%s}}\n' \
  "$role" "$expected_commit" "$service_identities"
echo "PASS: Staging $role services use expected release image digests and revision $expected_commit"
