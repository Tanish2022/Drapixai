#!/usr/bin/env bash
set -euo pipefail

TRIVY_IMAGE="aquasec/trivy@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e"

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <image-ref> [image-ref ...]" >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is required for container image scanning." >&2
  exit 1
fi

for image in "$@"; do
  echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities"
  docker run --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${HOME}/.cache/trivy:/root/.cache/" \
    "${TRIVY_IMAGE}" image \
    --exit-code 1 \
    --severity HIGH,CRITICAL \
    --pkg-types os,library \
    --scanners vuln \
    "${image}"
done
