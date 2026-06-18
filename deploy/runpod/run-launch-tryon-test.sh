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

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
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
  log "Running direct Standard CatVTON try-on"
  mkdir -p "$RESULT_DIR"
  if [[ ! -e "$ASSET_DIR/person.jpg" || "$(realpath "$PERSON_IMAGE")" != "$(realpath "$ASSET_DIR/person.jpg")" ]]; then
    cp "$PERSON_IMAGE" "$ASSET_DIR/person.jpg"
  fi
  if [[ ! -e "$ASSET_DIR/garment.jpg" || "$(realpath "$CLOTH_IMAGE")" != "$(realpath "$ASSET_DIR/garment.jpg")" ]]; then
    cp "$CLOTH_IMAGE" "$ASSET_DIR/garment.jpg"
  fi
  local started ended
  started="$("$PYTHON_BIN" - <<'PY'
import time
print(time.time())
PY
)"
  cd "$APP_ROOT"
  "$PYTHON_BIN" deploy/runpod/smoke_tryon.py
  ended="$("$PYTHON_BIN" - <<'PY'
import time
print(time.time())
PY
)"
  cp "$ASSET_DIR/result_direct.png" "$RESULT_DIR/direct_standard.png"
  cp "$ASSET_DIR/result_direct.json" "$RESULT_DIR/direct_standard.json"
  "$PYTHON_BIN" - "$started" "$ended" "$RESULT_DIR/direct_standard.json" <<'PY'
import json
import sys
from pathlib import Path

started, ended, metadata_path = float(sys.argv[1]), float(sys.argv[2]), Path(sys.argv[3])
data = json.loads(metadata_path.read_text())
data["wall_latency_ms"] = int((ended - started) * 1000)
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
  API_URL="$API_URL" \
  PERSON_IMAGE="$PERSON_IMAGE" \
  CLOTH_IMAGE="$CLOTH_IMAGE" \
  OUTPUT_FILE="$RESULT_DIR/sdk_standard.png" \
  HEADERS_FILE="$RESULT_DIR/sdk_standard.headers" \
  DOMAIN="staging.drapixai.com" \
  ORIGIN_URL="https://staging.drapixai.com" \
  GARMENT_ID="launch-green-shirt" \
  PRODUCT_ID="launch-green-shirt-product" \
    bash "$APP_ROOT/deploy/scripts/smoke-test.sh"
}

write_summary() {
  log "Writing summary"
  "$PYTHON_BIN" - "$RESULT_DIR" <<'PY'
import json
import re
import sys
from pathlib import Path

result_dir = Path(sys.argv[1])
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

summary = {
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

if direct_score is not None and sdk_score is not None and direct_score - sdk_score > 0.03:
    raise SystemExit(
        f"SDK quality score is lower than direct by more than 0.03: "
        f"direct={direct_score}, sdk={sdk_score}"
    )
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
