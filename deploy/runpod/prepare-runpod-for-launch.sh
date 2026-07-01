#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
PYTHON_SHIM_DIR="${DRAPIXAI_PYTHON_SHIM_DIR:-/tmp/drapixai-python311}"
CURRENT_BRANCH="$(git -C "$APP_ROOT" branch --show-current 2>/dev/null || true)"
REPO_BRANCH="${DRAPIXAI_REPO_BRANCH:-${CURRENT_BRANCH:-codex/catvton-runpod-clean}}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

ensure_python_311_path() {
  if command -v python >/dev/null 2>&1; then
    if python - <<'PY' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)
PY
    then
      return
    fi
  fi

  if ! command -v python3.11 >/dev/null 2>&1; then
    echo "python3.11 is required. Use RunPod image runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04." >&2
    exit 1
  fi

  mkdir -p "$PYTHON_SHIM_DIR"
  ln -sf "$(command -v python3.11)" "$PYTHON_SHIM_DIR/python"
  export PATH="$PYTHON_SHIM_DIR:$PATH"
}

model_assets_exist() {
  [[ -f "$APP_ROOT/models/catvton/mix-48k-1024/attention/model.safetensors" ]] &&
  [[ -f "$APP_ROOT/models/catvton/DensePose/model_final_162be9.pkl" ]] &&
  [[ -f "$APP_ROOT/models/catvton/SCHP/exp-schp-201908261155-lip.pth" ]]
}

main() {
  ensure_python_311_path
  cd "$APP_ROOT"

  local skip_model_download="${DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD:-auto}"
  if [[ "${DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD:-auto}" == "auto" ]]; then
    skip_model_download=0
    if model_assets_exist; then
      skip_model_download=1
    fi
  fi

  log "Preparing AI stack"
  DRAPIXAI_REPO_BRANCH="$REPO_BRANCH" \
  DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD="$skip_model_download" \
  DRAPIXAI_SETUP_RUN_SMOKE="${DRAPIXAI_SETUP_RUN_SMOKE:-0}" \
    bash "$APP_ROOT/deploy/runpod/setup-fresh-runpod.sh"

  log "Preparing SDK/API stack"
  bash "$APP_ROOT/deploy/runpod/setup-sdk-api-stack.sh"

  cat <<EOF

============================================================
DrapixAI RunPod launch environment is ready
============================================================

AI:
  http://127.0.0.1:8080

API / SDK:
  http://127.0.0.1:8000

Place test assets:
  ${APP_ROOT}/runtime/test_assets/person.jpg
  ${APP_ROOT}/runtime/test_assets/garment.jpg

Run direct + SDK validation:
  cd ${APP_ROOT}
  bash deploy/runpod/run-launch-tryon-test.sh

EOF
}

main "$@"
