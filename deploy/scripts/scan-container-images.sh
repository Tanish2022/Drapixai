#!/usr/bin/env bash
set -euo pipefail

TRIVY_IMAGE="aquasec/trivy@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e"
TRIVY_DB_REPOSITORY="${DRAPIXAI_TRIVY_DB_REPOSITORY:-ghcr.io/aquasecurity/trivy-db:2}"
TRIVY_CACHE_VOLUME="${DRAPIXAI_TRIVY_CACHE_VOLUME:-drapixai-trivy-cache}"

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <image-ref> [image-ref ...]" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is required for container image scanning." >&2
  exit 1
fi

scan_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${scan_dir}"
}
trap cleanup EXIT

scan_image() {
  local archive="$1"
  local image="$2"
  local attempt

  for attempt in 1 2 3; do
    echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities (attempt ${attempt}/3)"
    if docker run --rm \
      --read-only \
      --cap-drop ALL \
      --tmpfs /tmp:rw,noexec,nosuid,size=512m \
      --mount "type=bind,src=${archive},dst=/scan/image.tar,readonly" \
      --mount "type=volume,src=${TRIVY_CACHE_VOLUME},dst=/root/.cache/" \
      "${TRIVY_IMAGE}" image \
      --input /scan/image.tar \
      --db-repository "${TRIVY_DB_REPOSITORY}" \
      --exit-code 1 \
      --severity HIGH,CRITICAL \
      --pkg-types os,library \
      --scanners vuln \
      --skip-version-check; then
      return 0
    fi

    if [[ "${attempt}" -lt 3 ]]; then
      echo "Trivy scan failed; retrying once its vulnerability database or registry is available." >&2
      sleep "$((attempt * 10))"
    fi
  done

  echo "Trivy scan failed after 3 attempts; keeping the release gate closed." >&2
  return 1
}

index=0
for image in "$@"; do
  index=$((index + 1))
  archive="${scan_dir}/image-${index}.tar"

  echo "Exporting ${image} for isolated scanning"
  docker save --output "${archive}" "${image}"

  echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities"
  scan_image "${archive}" "${image}"
done
