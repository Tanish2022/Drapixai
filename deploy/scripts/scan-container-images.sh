#!/usr/bin/env bash
set -euo pipefail

TRIVY_IMAGE="aquasec/trivy@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e"
TRIVY_DB_REPOSITORY="${DRAPIXAI_TRIVY_DB_REPOSITORY:-public.ecr.aws/aquasecurity/trivy-db:2}"
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
  local report="$3"
  local attempt
  local parser_status

  for attempt in 1 2 3; do
    echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities (attempt ${attempt}/3)"
    rm -f "${report}"
    if docker run --rm \
      --read-only \
      --cap-drop ALL \
      --tmpfs /tmp:rw,noexec,nosuid,size=512m \
      --mount "type=bind,src=${scan_dir},dst=/scan" \
      --mount "type=volume,src=${TRIVY_CACHE_VOLUME},dst=/root/.cache/" \
      "${TRIVY_IMAGE}" image \
      --input /scan/image.tar \
      --db-repository "${TRIVY_DB_REPOSITORY}" \
      --format json \
      --output "/scan/$(basename "${report}")" \
      --severity HIGH,CRITICAL \
      --pkg-types os,library \
      --scanners vuln \
      --skip-version-check > "${report}"; then
      break
    fi

    if [[ "${attempt}" -lt 3 ]]; then
      echo "Trivy scan failed; retrying once its vulnerability database or registry is available." >&2
      sleep "$((attempt * 10))"
    fi
  done

  if [[ ! -s "${report}" ]]; then
    echo "Trivy could not produce a vulnerability report after 3 attempts; keeping the release gate closed." >&2
    return 20
  fi

  if python3 -c '
import json
import sys

report_path = sys.argv[1]
try:
    with open(report_path, encoding="utf-8") as report_file:
        report = json.load(report_file)
except (OSError, json.JSONDecodeError) as error:
    print(f"Trivy produced an unreadable report: {error}", file=sys.stderr)
    sys.exit(20)

results = report.get("Results")
if not isinstance(results, list):
    print("Trivy report does not contain a valid Results list.", file=sys.stderr)
    sys.exit(20)

findings = []
for result in results:
    vulnerabilities = result.get("Vulnerabilities") or []
    if not isinstance(vulnerabilities, list):
        print("Trivy report contains an invalid Vulnerabilities field.", file=sys.stderr)
        sys.exit(20)
    for vulnerability in vulnerabilities:
        findings.append(
            "{id} {severity} {package} {installed} -> {fixed}".format(
                id=vulnerability.get("VulnerabilityID", "UNKNOWN"),
                severity=vulnerability.get("Severity", "UNKNOWN"),
                package=vulnerability.get("PkgName", "UNKNOWN"),
                installed=vulnerability.get("InstalledVersion", "UNKNOWN"),
                fixed=vulnerability.get("FixedVersion") or "no fixed version",
            )
        )

if findings:
    print("HIGH/CRITICAL vulnerabilities found:", file=sys.stderr)
    print("\n".join(findings), file=sys.stderr)
    sys.exit(10)

print("No HIGH/CRITICAL OS or library vulnerabilities found.")
' "${report}"; then
    return 0
  else
    parser_status=$?
  fi

  if [[ "${parser_status}" -eq 10 ]]; then
    echo "Trivy found release-blocking HIGH/CRITICAL vulnerabilities." >&2
    return 10
  fi

  echo "Trivy report validation failed; keeping the release gate closed." >&2
  return 20
}

index=0
for image in "$@"; do
  index=$((index + 1))
  archive="${scan_dir}/image-${index}.tar"
  report="${scan_dir}/report-${index}.json"

  echo "Exporting ${image} for isolated scanning"
  docker save --output "${archive}" "${image}"

  echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities"
  scan_image "${archive}" "${image}" "${report}"
done
