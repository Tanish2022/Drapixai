#!/usr/bin/env bash
set -euo pipefail

TRIVY_IMAGE="aquasec/trivy@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e"
TRIVY_DB_REPOSITORY="${DRAPIXAI_TRIVY_DB_REPOSITORY:-public.ecr.aws/aquasecurity/trivy-db:2}"
TRIVY_CACHE_VOLUME="${DRAPIXAI_TRIVY_CACHE_VOLUME:-drapixai-trivy-cache}"
TRIVY_TIMEOUT="${DRAPIXAI_TRIVY_TIMEOUT:-45m}"
EVIDENCE_PATH="${DRAPIXAI_CONTAINER_SCAN_EVIDENCE:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VEX_PATH="${DRAPIXAI_TRIVY_VEX_PATH:-${REPO_ROOT}/deploy/security/vex/openssl-3.0-cve-2026-14456.openvex.json}"

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <image-ref> [image-ref ...]" >&2
  exit 2
fi

if [[ ! "${TRIVY_TIMEOUT}" =~ ^[1-9][0-9]*(s|m|h)$ ]]; then
  echo "DRAPIXAI_TRIVY_TIMEOUT must be a positive bounded duration such as 45m or 1h." >&2
  exit 2
fi

[[ -f "${VEX_PATH}" ]] || {
  echo "The reviewed Trivy VEX document is missing: ${VEX_PATH}" >&2
  exit 2
}

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is required for container image scanning." >&2
  exit 1
fi

scan_dir="$(mktemp -d)"
evidence_rows="${scan_dir}/evidence.ndjson"
scan_started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
release_commit="${DRAPIXAI_RELEASE_COMMIT:-}"

if [[ -n "${EVIDENCE_PATH}" ]]; then
  current_commit="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  release_commit="${release_commit:-$current_commit}"
  [[ "${release_commit}" =~ ^[a-f0-9]{40}$ && "${release_commit}" == "${current_commit}" ]] || {
    echo "Container-scan evidence must target the exact checked-out release commit." >&2
    exit 2
  }
  [[ -z "$(git -C "${REPO_ROOT}" status --porcelain)" ]] || {
    echo "Container-scan evidence requires a clean release checkout." >&2
    exit 2
  }
  EVIDENCE_PATH="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "${EVIDENCE_PATH}")"
  evidence_root="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "${REPO_ROOT}/runtime/launch-evidence")"
  case "${EVIDENCE_PATH}" in
    "${evidence_root}"/*) ;;
    *) echo "Container-scan evidence must stay under runtime/launch-evidence." >&2; exit 2 ;;
  esac
  evidence_reports_dir="${EVIDENCE_PATH%.json}.reports"
  mkdir -p "$(dirname "${EVIDENCE_PATH}")" "${evidence_reports_dir}"
fi

cleanup() {
  rm -rf "${scan_dir}"
}
trap cleanup EXIT

record_scan() {
  local image="$1"
  local image_id="$2"
  local image_revision="$3"
  local report="$4"
  local retained_report="$5"
  local status="$6"
  local scanner_exit="$7"
  local scanner_log="$8"

  [[ -n "${EVIDENCE_PATH}" ]] || return 0
  python3 - "${image}" "${image_id}" "${image_revision}" "${report}" "${retained_report}" "${status}" "${scanner_exit}" "${scanner_log}" "${REPO_ROOT}" >> "${evidence_rows}" <<'PY'
import hashlib
import json
import pathlib
import sys

image, image_id, image_revision, report_name, retained_name, status, scanner_exit, scanner_log, repo_root = sys.argv[1:]
report_path = pathlib.Path(report_name)
retained_path = pathlib.Path(retained_name) if retained_name else None
vulnerabilities = []
if report_path.is_file() and report_path.stat().st_size:
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
        for result in report.get("Results") or []:
            vulnerabilities.extend(result.get("Vulnerabilities") or [])
    except (OSError, json.JSONDecodeError, TypeError):
        pass

def relative(path: pathlib.Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.resolve().relative_to(pathlib.Path(repo_root).resolve()).as_posix()
    except ValueError:
        return path.name

row = {
    "image": image,
    "imageId": image_id,
    "imageRevision": image_revision,
    "status": status,
    "scannerExitCode": int(scanner_exit),
    "highFindings": sum(1 for item in vulnerabilities if item.get("Severity") == "HIGH"),
    "criticalFindings": sum(1 for item in vulnerabilities if item.get("Severity") == "CRITICAL"),
    "report": relative(retained_path),
    "reportSha256": hashlib.sha256(report_path.read_bytes()).hexdigest() if report_path.is_file() else None,
    "scannerError": pathlib.Path(scanner_log).read_text(encoding="utf-8", errors="replace")[-1000:].strip() if pathlib.Path(scanner_log).is_file() and status != "PASS" else None,
}
print(json.dumps(row, separators=(",", ":")))
PY
}

write_evidence() {
  [[ -n "${EVIDENCE_PATH}" ]] || return 0
  python3 - "${evidence_rows}" "${EVIDENCE_PATH}" "${release_commit}" "${scan_started_at}" "${TRIVY_IMAGE}" "${TRIVY_DB_REPOSITORY}" "${TRIVY_TIMEOUT}" "${VEX_PATH}" "${REPO_ROOT}" <<'PY'
import hashlib
import json
import os
import pathlib
import sys
from datetime import datetime, timezone

rows_path, output_name, release_commit, started_at, scanner_image, database_repository, scan_timeout, vex_name, repo_root = sys.argv[1:]
rows_file = pathlib.Path(rows_path)
vex_path = pathlib.Path(vex_name)
vex_relative = vex_path.resolve().relative_to(pathlib.Path(repo_root).resolve()).as_posix()
images = [json.loads(line) for line in rows_file.read_text(encoding="utf-8").splitlines() if line.strip()] if rows_file.exists() else []
passed = bool(images) and all(
    image.get("status") == "PASS"
    and image.get("highFindings") == 0
    and image.get("criticalFindings") == 0
    and image.get("reportSha256")
    for image in images
)
document = {
    "schemaVersion": 1,
    "releaseCommit": release_commit,
    "startedAt": started_at,
    "completedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "scannerImage": scanner_image,
    "vulnerabilityDatabaseRepository": database_repository,
    "scanTimeout": scan_timeout,
    "vexDocument": vex_relative,
    "vexSha256": hashlib.sha256(vex_path.read_bytes()).hexdigest(),
    "severityGate": ["HIGH", "CRITICAL"],
    "status": "PASS" if passed else "FAIL",
    "images": images,
}
output = pathlib.Path(output_name)
temporary = output.with_suffix(output.suffix + ".tmp")
temporary.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
os.chmod(temporary, 0o600)
temporary.replace(output)
print(f"Container scan evidence: {output}")
PY
}

emit_error() {
  local message="$1"

  echo "${message}" >&2
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    message="${message//%/%25}"
    message="${message//$'\r'/}"
    message="${message//$'\n'/%0A}"
    printf '::error title=DrapixAI container scan::%s\n' "${message}"
  fi
}

scan_image() {
  local archive="$1"
  local image="$2"
  local report="$3"
  local scratch="$4"
  local attempt
  local parser_status
  local trivy_log
  local last_failure="no command error captured"

  for attempt in 1 2 3; do
    echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities (attempt ${attempt}/3)"
    trivy_log="${report}.attempt-${attempt}.log"
    rm -f "${report}" "${trivy_log}"
    rm -rf "${scratch}"
    mkdir -p "${scratch}"
    if docker run --rm \
      --read-only \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --mount "type=bind,src=${scratch},dst=/tmp" \
      --mount "type=bind,src=${archive},dst=/scan/image.tar,readonly" \
      --mount "type=bind,src=${VEX_PATH},dst=/scan/vex.openvex.json,readonly" \
      --mount "type=volume,src=${TRIVY_CACHE_VOLUME},dst=/root/.cache/" \
      "${TRIVY_IMAGE}" image \
      --input /scan/image.tar \
      --db-repository "${TRIVY_DB_REPOSITORY}" \
      --format json \
      --severity HIGH,CRITICAL \
      --pkg-types os,library \
      --scanners vuln \
      --vex /scan/vex.openvex.json \
      --timeout "${TRIVY_TIMEOUT}" \
      --skip-version-check > "${report}" 2>"${trivy_log}"; then
      break
    fi

    last_failure="$(tail -n 4 "${trivy_log}" 2>/dev/null | tr '\n' ' ')"
    if [[ "${attempt}" -lt 3 ]]; then
      echo "Trivy scan failed; retrying once its vulnerability database or registry is available." >&2
      sleep "$((attempt * 10))"
    fi
  done

  if [[ ! -s "${report}" ]]; then
    emit_error "Trivy could not produce a vulnerability report after 3 attempts; keeping the release gate closed. Last scanner error: ${last_failure}"
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

  emit_error "Trivy report validation failed; keeping the release gate closed."
  return 20
}

index=0
for image in "$@"; do
  index=$((index + 1))
  archive="${scan_dir}/image-${index}.tar"
  report="${scan_dir}/report-${index}.json"
  scratch="${scan_dir}/scratch-${index}"
  image_id="$(docker image inspect --format '{{.Id}}' "${image}")"
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${image}")"
  retained_report=""

  if [[ -n "${EVIDENCE_PATH}" && "${image_revision}" != "${release_commit}" ]]; then
    printf 'Image revision label %s does not match release commit %s.\n' "${image_revision:-missing}" "${release_commit}" > "${report}.attempt-3.log"
    record_scan "${image}" "${image_id}" "${image_revision}" "${report}" "" "FAIL" "21" "${report}.attempt-3.log"
    write_evidence
    exit 21
  fi

  echo "Exporting ${image} for isolated scanning"
  docker save --output "${archive}" "${image}"
  chmod 0644 "${archive}"

  echo "Scanning ${image} for HIGH and CRITICAL vulnerabilities"
  if scan_image "${archive}" "${image}" "${report}" "${scratch}"; then
    scanner_exit=0
    scan_status="PASS"
  else
    scanner_exit=$?
    scan_status="FAIL"
  fi

  if [[ -n "${EVIDENCE_PATH}" && -s "${report}" ]]; then
    retained_report="${evidence_reports_dir}/image-${index}.json"
    cp "${report}" "${retained_report}"
    chmod 0600 "${retained_report}"
  fi
  record_scan "${image}" "${image_id}" "${image_revision}" "${report}" "${retained_report}" "${scan_status}" "${scanner_exit}" "${report}.attempt-3.log"
  if [[ "${scanner_exit}" -ne 0 ]]; then
    write_evidence
    exit "${scanner_exit}"
  fi
done

write_evidence
