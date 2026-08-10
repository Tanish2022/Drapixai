#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
ASSET_DIR="${DRAPIXAI_TEST_ASSET_DIR:-$APP_ROOT/runtime/test_assets}"
RESULT_DIR="${DRAPIXAI_TEST_RESULT_DIR:-$APP_ROOT/runtime/launch_tryon_test}"
PERSON_IMAGE="${PERSON_IMAGE:-$ASSET_DIR/person.jpg}"
CLOTH_IMAGE="${CLOTH_IMAGE:-$ASSET_DIR/garment.jpg}"
API_URL="${API_URL:-http://127.0.0.1:8000}"
AI_URL="${AI_URL:-http://127.0.0.1:8080}"
PYTHON_BIN="${DRAPIXAI_PYTHON_BIN:-python}"
API_ENV_FILE="${DRAPIXAI_API_ENV_FILE:-$APP_ROOT/apps/api/.env}"
AI_ENV_FILE="${DRAPIXAI_AI_ENV_FILE:-$APP_ROOT/deploy/env/ai.runpod.env}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}
read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 0
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}
require_file() {
  local path="$1"
  local label="$2"
  if [[ ! -s "$path" ]]; then
    cat >&2 <<EOF
Missing ${label}: ${path}

Place test assets here:
  ${ASSET_DIR}/person.jpg
  ${ASSET_DIR}/garment.jpg

Then rerun:
  cd ${APP_ROOT}
  bash deploy/runpod/run-launch-tryon-test.sh
EOF
    exit 1
  fi
}

ensure_python_runtime() {
  if "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)
PY
  then
    return
  fi

  if command -v python3.11 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3.11)"
    export PYTHON_BIN
    return
  fi

  echo "Python 3.11 is required for DrapixAI CatVTON tests." >&2
  exit 1
}

check_services() {
  log "Checking AI and API readiness"
  curl -fsS "${AI_URL%/}/health" >/dev/null
  curl -fsS "${AI_URL%/}/ready" >/dev/null
  curl -fsS "${API_URL%/}/health" >/dev/null
  curl -fsS "${API_URL%/}/ready" >/dev/null
}

run_direct_tryon() {
  log "Running direct Standard CatVTON try-on through the warm AI API"
  mkdir -p "$RESULT_DIR"
  local started ended ai_service_token headers_file
  ai_service_token="${DRAPIXAI_AI_SERVICE_TOKEN:-}"
  if [[ -z "$ai_service_token" ]]; then
    ai_service_token="$(read_env_value DRAPIXAI_AI_SERVICE_TOKEN "$AI_ENV_FILE")"
  fi
  if [[ -z "$ai_service_token" ]]; then
    echo "Missing DRAPIXAI_AI_SERVICE_TOKEN for authenticated direct AI smoke." >&2
    exit 1
  fi
  headers_file="$RESULT_DIR/direct_standard.headers"
  started="$("$PYTHON_BIN" - <<'PY'
import time
print(time.time())
PY
)"
  curl --fail --silent --show-error \
    -X POST "${AI_URL%/}/ai/tryon" \
    -H "x-drapixai-service-token: ${ai_service_token}" \
    -F "user_id=launch-direct-smoke" \
    -F "person_image=@${PERSON_IMAGE}" \
    -F "cloth_image=@${CLOTH_IMAGE}" \
    -F "garment_type=upper" \
    -F "quality=standard" \
    -D "$headers_file" \
    -o "$RESULT_DIR/direct_standard.png"
  ended="$("$PYTHON_BIN" - <<'PY'
import time
print(time.time())
PY
)"
  "$PYTHON_BIN" - "$started" "$ended" "$headers_file" "$RESULT_DIR/direct_standard.json" <<'PY'
import json
import sys
from pathlib import Path

started, ended = float(sys.argv[1]), float(sys.argv[2])
headers_path, metadata_path = Path(sys.argv[3]), Path(sys.argv[4])
headers = {}
for line in headers_path.read_text(errors="ignore").splitlines():
    if ":" in line:
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()

def parse_json_header(name, fallback):
    try:
        return json.loads(headers.get(name, ""))
    except json.JSONDecodeError:
        return fallback

warnings = [item for item in headers.get("x-drapixai-warnings", "").split(",") if item]
timings = parse_json_header("x-drapixai-timing-json", {})
quality_metrics = parse_json_header("x-drapixai-quality-json", {})
data = {
    "engine": headers.get("x-drapixai-engine"),
    "quality_score": float(headers.get("x-drapixai-quality-score") or 0),
    "candidate_count": int(headers.get("x-drapixai-candidate-count") or 0),
    "warnings": warnings,
    "metadata": {"timings": timings, **quality_metrics},
    "processing_ms": int(headers.get("x-drapixai-processing-ms") or 0),
    "quality_mode": headers.get("x-drapixai-quality-mode"),
    "garment_source": headers.get("x-drapixai-garment-source"),
    "wall_latency_ms": int((ended - started) * 1000),
}
metadata_path.write_text(json.dumps(data, indent=2))
print(json.dumps({
    "direct_quality_score": data.get("quality_score"),
    "direct_candidate_count": data.get("candidate_count"),
    "direct_wall_latency_ms": data.get("wall_latency_ms"),
    "direct_warnings": data.get("warnings"),
}, indent=2))
PY
}

run_sdk_tryon() {
  log "Running SDK/API Standard try-on through product mapping and cached garment"
  mkdir -p "$RESULT_DIR"
  local dashboard_proxy_token="${DRAPIXAI_DASHBOARD_PROXY_TOKEN:-${DASHBOARD_PROXY_TOKEN:-}}"
  if [[ -z "$dashboard_proxy_token" ]]; then
    dashboard_proxy_token="$(read_env_value DRAPIXAI_DASHBOARD_PROXY_TOKEN "$API_ENV_FILE")"
  fi
  if [[ -z "$dashboard_proxy_token" ]]; then
    echo "Missing DRAPIXAI_DASHBOARD_PROXY_TOKEN. Run deploy/runpod/setup-sdk-api-stack.sh or set DASHBOARD_PROXY_TOKEN before launch validation." >&2
    exit 1
  fi

  API_URL="$API_URL" \
  DASHBOARD_PROXY_TOKEN="$dashboard_proxy_token" \
  DRAPIXAI_SMOKE_PREPARE_ACCOUNT=1 \
  PERSON_IMAGE="$PERSON_IMAGE" \
  CLOTH_IMAGE="$CLOTH_IMAGE" \
  OUTPUT_FILE="$RESULT_DIR/sdk_standard.png" \
  HEADERS_FILE="$RESULT_DIR/sdk_standard.headers" \
  DOMAIN="staging.drapixai.com" \
  ORIGIN_URL="https://staging.drapixai.com" \
  GARMENT_ID="launch-graphic-tee" \
  PRODUCT_ID="launch-graphic-tee-product" \
  GARMENT_CATEGORY="tshirt" \
    bash "$APP_ROOT/deploy/scripts/smoke-test.sh"
}

write_summary() {
  log "Writing summary"
  "$PYTHON_BIN" - "$RESULT_DIR" "$APP_ROOT" <<'PY'
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

result_dir = Path(sys.argv[1])
app_root = Path(sys.argv[2])
direct = {}
direct_path = result_dir / "direct_standard.json"
if direct_path.exists():
    direct = json.loads(direct_path.read_text())

headers = {}
headers_path = result_dir / "sdk_standard.headers"
if headers_path.exists():
    for line in headers_path.read_text(errors="ignore").splitlines():
      if ":" in line:
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()

def run_text(args, cwd=None):
    try:
        completed = subprocess.run(
            args,
            cwd=cwd,
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
        return completed.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


gpu_name = None
gpu_memory_mib = None
driver_version = None
gpu_row = run_text([
    "nvidia-smi",
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader,nounits",
])
if gpu_row:
    parts = [part.strip() for part in gpu_row.splitlines()[0].split(",", 2)]
    if len(parts) == 3:
        gpu_name, memory_raw, driver_version = parts
        try:
            gpu_memory_mib = int(memory_raw)
        except ValueError:
            gpu_memory_mib = None

try:
    import torch
    torch_version = torch.__version__
    torch_cuda_runtime = torch.version.cuda
except (ImportError, RuntimeError):
    torch_version = None
    torch_cuda_runtime = None

summary = {
    "evidence": {
        "runtime_profile": "runpod-reference",
        "production_runtime_equivalent": False,
        "quality_evidence_scope": "reference-quality-and-sdk-parity",
        "git_commit": run_text(["git", "rev-parse", "HEAD"], cwd=app_root),
        "platform": platform.platform(),
        "python_version": platform.python_version(),
        "torch_version": torch_version,
        "torch_cuda_runtime": torch_cuda_runtime,
        "gpu_name": gpu_name,
        "gpu_memory_mib": gpu_memory_mib,
        "driver_version": driver_version,
    },
    "direct": {
        "image": str(result_dir / "direct_standard.png"),
        "quality_score": direct.get("quality_score"),
        "candidate_count": direct.get("candidate_count"),
        "wall_latency_ms": direct.get("wall_latency_ms"),
        "pipeline_total_ms": ((direct.get("metadata") or {}).get("timings") or {}).get("pipeline_total_ms"),
        "warnings": direct.get("warnings", []),
    },
    "sdk": {
        "image": str(result_dir / "sdk_standard.png"),
        "quality_score": headers.get("x-drapixai-quality-score"),
        "candidate_count": headers.get("x-drapixai-candidate-count"),
        "latency_ms": headers.get("x-drapixai-latency-ms"),
        "processing_ms": headers.get("x-drapixai-processing-ms"),
        "quality_mode": headers.get("x-drapixai-quality-mode"),
        "garment_source": headers.get("x-drapixai-garment-source"),
        "garment_cache_status": headers.get("x-drapixai-garment-cache-status"),
        "warnings": headers.get("x-drapixai-warnings"),
    },
}
(result_dir / "summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps(summary, indent=2))

direct_score = summary["direct"]["quality_score"]
sdk_score_raw = summary["sdk"]["quality_score"]
sdk_score = None
if sdk_score_raw:
    match = re.search(r"[0-9]+(?:\.[0-9]+)?", sdk_score_raw)
    sdk_score = float(match.group(0)) if match else None

min_quality = float(os.getenv("DRAPIXAI_LAUNCH_MIN_QUALITY_SCORE", "0.95"))
max_latency_ms = int(os.getenv("DRAPIXAI_LAUNCH_TARGET_LATENCY_MS", "12000"))
failures = []
if direct_score is None:
    failures.append("direct quality score is missing")
elif direct_score < min_quality:
    failures.append(f"direct quality {direct_score:.3f} is below launch minimum {min_quality:.3f}")
if summary["direct"].get("candidate_count") != 1:
    failures.append(f"direct candidate_count must be 1, got {summary['direct'].get('candidate_count')!r}")
if summary["direct"].get("warnings"):
    failures.append(f"direct warnings must be empty, got {summary['direct'].get('warnings')!r}")
if sdk_score is None:
    failures.append("SDK quality score is missing")
elif sdk_score < min_quality:
    failures.append(f"SDK quality {sdk_score:.3f} is below launch minimum {min_quality:.3f}")
if direct_score is not None and sdk_score is not None and direct_score - sdk_score > 0.03:
    failures.append(f"SDK quality score is lower than direct by more than 0.03: direct={direct_score}, sdk={sdk_score}")
try:
    sdk_latency = int(summary["sdk"].get("latency_ms") or 0)
except ValueError:
    sdk_latency = 0
if sdk_latency <= 0:
    failures.append("SDK latency is missing")
elif sdk_latency > max_latency_ms:
    failures.append(f"SDK latency {sdk_latency}ms exceeds launch target {max_latency_ms}ms")
if summary["sdk"].get("candidate_count") not in ("1", 1):
    failures.append(f"SDK candidate_count must be 1, got {summary['sdk'].get('candidate_count')!r}")
if summary["sdk"].get("warnings"):
    failures.append(f"SDK warnings must be empty, got {summary['sdk'].get('warnings')!r}")
if summary["sdk"].get("quality_mode") != "standard":
    failures.append(f"SDK quality mode must be standard, got {summary['sdk'].get('quality_mode')!r}")
if summary["sdk"].get("garment_source") != "original_verified_cache_gate":
    failures.append(f"SDK garment source must be original_verified_cache_gate, got {summary['sdk'].get('garment_source')!r}")
if summary["sdk"].get("garment_cache_status") != "verified":
    failures.append(f"SDK garment cache status must be verified, got {summary['sdk'].get('garment_cache_status')!r}")
if failures:
    raise SystemExit("Launch try-on gates failed:\n- " + "\n- ".join(failures))
PY
}

main() {
  mkdir -p "$ASSET_DIR" "$RESULT_DIR"
  ensure_python_runtime
  require_file "$PERSON_IMAGE" "person image"
  require_file "$CLOTH_IMAGE" "garment image"
  check_services
  run_direct_tryon
  run_sdk_tryon
  write_summary

  cat <<EOF

============================================================
DrapixAI launch try-on test complete
============================================================

Results:
  ${RESULT_DIR}/direct_standard.png
  ${RESULT_DIR}/sdk_standard.png
  ${RESULT_DIR}/summary.json

EOF
}

main "$@"
