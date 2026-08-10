#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
REPO_URL="${DRAPIXAI_REPO_URL:-https://github.com/Tanish2022/Drapixai.git}"
REPO_BRANCH="${DRAPIXAI_REPO_BRANCH:-codex/catvton-runpod-clean}"
ENV_FILE="${DRAPIXAI_AI_ENV_FILE:-$APP_ROOT/deploy/env/ai.runpod.env}"
PORT="${PORT:-8080}"
RUN_START="${DRAPIXAI_SETUP_START_SERVICES:-1}"
RUN_SMOKE="${DRAPIXAI_SETUP_RUN_SMOKE:-0}"
SKIP_MODEL_DOWNLOAD="${DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD:-0}"
SKIP_REPO_SYNC="${DRAPIXAI_SETUP_SKIP_REPO_SYNC:-0}"
LOG_FILE="/tmp/drapixai-fresh-runpod-setup.log"
VENV_DIR="${DRAPIXAI_VENV:-$APP_ROOT/.venv}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

print_troubleshooting() {
  local line_number="${1:-unknown}"
  local command="${2:-unknown}"
  set +e
  printf '\n============================================================\n'
  printf 'DrapixAI RunPod setup failed\n'
  printf '============================================================\n'
  printf 'Failed near line: %s\n' "$line_number"
  printf 'Command: %s\n' "$command"
  printf 'Log file: %s\n' "$LOG_FILE"
  printf '\nQuick checks:\n'
  printf '1. GPU visibility: nvidia-smi\n'
  printf '2. Disk space: df -h /workspace\n'
  printf '3. Repo status: cd %s && git status -sb\n' "$APP_ROOT"
  printf '4. Env file: grep -Ev "(TOKEN|SECRET|PASSWORD|ACCESS_KEY)" %s\n' "$ENV_FILE"
  printf '5. AI logs: tail -n 200 %s/runtime/logs/*.log\n' "$APP_ROOT"
  printf '6. Port 8080: ss -ltnp | grep %s\n' "$PORT"
  printf '7. Redis: redis-cli ping\n'
  printf '\nCommon fixes:\n'
  printf '%s\n' '- If git clone failed, check network access and REPO_URL.'
  printf '%s\n' '- If apt failed, run: apt-get update'
  printf '%s\n' '- If pip/model download failed, check disk space and internet access.'
  printf '%s\n' '- If preflight says model files are missing, rerun with DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD=0.'
  printf -- '- If port %s is busy, run: fuser -k %s/tcp\n' "$PORT" "$PORT"
  printf '%s\n' '- If Redis is down, run: bash deploy/runpod/start-redis.sh'
  printf '\nRecent system context:\n'
  nvidia-smi || true
  df -h /workspace || true
  pgrep -af "redis-server|uvicorn|gpu_worker|rq worker" || true
  if [[ -d "$APP_ROOT/runtime/logs" ]]; then
    tail -n 120 "$APP_ROOT"/runtime/logs/*.log 2>/dev/null || true
  fi
  printf '\nAfter fixing the issue, rerun:\n'
  printf 'bash %s/deploy/runpod/setup-fresh-runpod.sh\n' "$APP_ROOT"
}

on_error() {
  local exit_code="$1"
  local line_number="$2"
  local command="$3"
  trap - ERR
  print_troubleshooting "$line_number" "$command"
  exit "$exit_code"
}

trap 'on_error "$?" "$LINENO" "$BASH_COMMAND"' ERR

require_root_or_sudo() {
  APT_PREFIX=()
  if [[ "$(id -u)" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "This script needs root or sudo access to install system packages." >&2
      exit 1
    fi
    APT_PREFIX=(sudo)
  fi
}

install_system_packages() {
  log "Installing RunPod system packages"
  require_root_or_sudo
  "${APT_PREFIX[@]}" apt-get update
  "${APT_PREFIX[@]}" apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    git \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    redis-server
  if command -v python3.11 >/dev/null 2>&1; then
    "${APT_PREFIX[@]}" apt-get install -y --no-install-recommends python3.11-venv || true
  fi
}

sync_repo() {
  log "Preparing DrapixAI repo at $APP_ROOT"
  if [[ "$SKIP_REPO_SYNC" == "1" ]]; then
    if [[ ! -d "$APP_ROOT/.git" ]]; then
      echo "DRAPIXAI_SETUP_SKIP_REPO_SYNC=1 requires an existing Git checkout at $APP_ROOT." >&2
      exit 1
    fi
    log "Keeping the existing repo overlay because DRAPIXAI_SETUP_SKIP_REPO_SYNC=1"
    cd "$APP_ROOT"
    return
  fi
  mkdir -p "$(dirname "$APP_ROOT")"
  if [[ -d "$APP_ROOT/.git" ]]; then
    cd "$APP_ROOT"
    if [[ -z "$REPO_BRANCH" ]]; then
      REPO_BRANCH="$(git branch --show-current)"
    fi
    git fetch origin "$REPO_BRANCH"
    git checkout "$REPO_BRANCH"
    git pull --ff-only origin "$REPO_BRANCH"
  else
    if [[ -e "$APP_ROOT" ]]; then
      local backup_path="${APP_ROOT}.backup.$(date '+%Y%m%d%H%M%S')"
      log "Existing non-git path found. Moving it to $backup_path"
      mv "$APP_ROOT" "$backup_path"
    fi
    REPO_BRANCH="${REPO_BRANCH:-codex/catvton-runpod-clean}"
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_ROOT"
    cd "$APP_ROOT"
  fi
}

ensure_python_venv() {
  log "Preparing Python 3.11 virtual environment"
  cd "$APP_ROOT"
  if ! command -v python3.11 >/dev/null 2>&1; then
    echo "python3.11 is required for the DrapixAI CatVTON stack." >&2
    exit 1
  fi
  if [[ ! -x "$VENV_DIR/bin/python" ]]; then
    python3.11 -m venv "$VENV_DIR"
  fi
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  export DRAPIXAI_VENV="$VENV_DIR"
  python -m pip install --upgrade pip setuptools wheel
}

generate_secret() {
  python - <<'PY'
import secrets
import string

alphabet = string.ascii_letters + string.digits + "-_"
print("".join(secrets.choice(alphabet) for _ in range(64)))
PY
}

upsert_env() {
  local key="$1"
  local value="$2"
  ENV_FILE="$ENV_FILE" ENV_KEY="$key" ENV_VALUE="$value" python3 - <<'PY'
import os
from pathlib import Path

env_file = Path(os.environ["ENV_FILE"])
key = os.environ["ENV_KEY"]
value = os.environ["ENV_VALUE"]
line = f"{key}={value}\n"

lines = env_file.read_text(encoding="utf-8").splitlines(keepends=True) if env_file.exists() else []
for index, current in enumerate(lines):
    if current.startswith(f"{key}="):
        lines[index] = line
        break
else:
    lines.append(line)

env_file.write_text("".join(lines), encoding="utf-8")
PY
}

require_for_backend() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Set $name when DRAPIXAI_GARMENT_CACHE_BACKEND=s3." >&2
    exit 1
  fi
}

ensure_env_file() {
  log "Creating and normalizing AI env file"
  cd "$APP_ROOT"
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$APP_ROOT/deploy/env/ai.staging.example" "$ENV_FILE"
  fi

  upsert_env "DRAPIXAI_AI_VALIDATION_PROFILE" "ai-reference"
  upsert_env "DRAPIXAI_VENV" "$VENV_DIR"
  upsert_env "DRAPIXAI_GPU_PRESET" "runpod-a100"
  upsert_env "DRAPIXAI_DEVICE" "cuda"
  upsert_env "DRAPIXAI_CUDA_DEVICE" "0"
  upsert_env "DRAPIXAI_REDIS_URL" "redis://127.0.0.1:6379/0"
  current_redis_password="$(grep '^DRAPIXAI_REDIS_PASSWORD=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$current_redis_password" || "$current_redis_password" == replace-* ]]; then
    upsert_env "DRAPIXAI_REDIS_PASSWORD" "$(generate_secret)"
  fi
  upsert_env "DRAPIXAI_QUEUE_TTL" "180"
  upsert_env "DRAPIXAI_RESULT_TTL" "60"
  upsert_env "DRAPIXAI_FAILURE_TTL" "60"
  upsert_env "DRAPIXAI_TRANSIENT_SPOOL_DIR" "/dev/shm/drapixai-tryon-spool"
  upsert_env "DRAPIXAI_TRANSIENT_SPOOL_TTL" "900"
  upsert_env "DRAPIXAI_ENV" "staging"
  upsert_env "DRAPIXAI_TRYON_ENGINE" "catvton"
  upsert_env "DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK" "0"
  upsert_env "DRAPIXAI_MODEL_DIR" "$APP_ROOT/models/catvton"
  upsert_env "DRAPIXAI_CATVTON_MODEL_DIR" "$APP_ROOT/models/catvton"
  upsert_env "DRAPIXAI_CATVTON_REPO_ID" "zhengchong/CatVTON"
  upsert_env "DRAPIXAI_CATVTON_GIT_BRANCH" "edited"
  upsert_env "DRAPIXAI_CATVTON_GIT_COMMIT" "7818397f25613beedb3d861a34769f607cfcf3b1"
  upsert_env "DRAPIXAI_CATVTON_MODEL_REVISION" "2969fcf85fe62f2036605716f0b56f0b81d01d79"
  upsert_env "DRAPIXAI_CATVTON_BASE_REPO_ID" "runwayml/stable-diffusion-inpainting"
  upsert_env "DRAPIXAI_CATVTON_BASE_MODEL" "$APP_ROOT/models/stable-diffusion-inpainting"
  upsert_env "DRAPIXAI_CATVTON_BASE_REVISION" "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb"
  upsert_env "DRAPIXAI_CATVTON_VAE_REPO_ID" "stabilityai/sd-vae-ft-mse"
  upsert_env "DRAPIXAI_CATVTON_VAE_MODEL" "$APP_ROOT/models/sd-vae-ft-mse"
  upsert_env "DRAPIXAI_CATVTON_VAE_REVISION" "31f26fdeee1355a5c34592e401dd41e45d25a493"
  upsert_env "DRAPIXAI_GARMENT_CACHE_DIR" "$APP_ROOT/runtime/garments"
  upsert_env "DRAPIXAI_GARMENT_CACHE_VERSION" "v3-1024x1365"
  upsert_env "DRAPIXAI_GARMENT_TARGET_WIDTH" "1024"
  upsert_env "DRAPIXAI_GARMENT_TARGET_HEIGHT" "1365"
  upsert_env "DRAPIXAI_GARMENT_CONDITION_MAX_EDGE" "1536"
  upsert_env "DRAPIXAI_RUNTIME_CACHE_ROOT" "$APP_ROOT/runtime/cache"
  upsert_env "DRAPIXAI_INPUT_MAX_SIDE" "640"
  upsert_env "DRAPIXAI_UPPER_BODY_REJECT_EDGE_RATIO" "0"
  upsert_env "DRAPIXAI_INFERENCE_STEPS" "22"
  upsert_env "DRAPIXAI_GUIDANCE_SCALE" "2.5"
  upsert_env "DRAPIXAI_TARGET_TRYON_MS" "12000"
  upsert_env "DRAPIXAI_ENABLE_GARMENT_COLOR_FIX" "1"
  upsert_env "DRAPIXAI_GARMENT_COLOR_FIX_STRENGTH" "0.94"
  upsert_env "DRAPIXAI_GARMENT_COLOR_FIX_EDGE_GUARD" "1"
  upsert_env "DRAPIXAI_BACKGROUND_COLOR_CAST_THRESHOLD" "0.055"
  upsert_env "DRAPIXAI_ENABLE_NATURAL_LIGHTING_FIX" "1"
  upsert_env "DRAPIXAI_NATURAL_LIGHTING_STRENGTH" "0.55"
  upsert_env "DRAPIXAI_ENABLE_FASHION_POLISH" "1"
  upsert_env "DRAPIXAI_FASHION_POLISH_STRENGTH" "0.45"
  upsert_env "DRAPIXAI_ENABLE_PERSON_CONTEXT_RESTORE" "0"
  upsert_env "DRAPIXAI_PERSON_CONTEXT_RESTORE_STRENGTH" "0.92"
  upsert_env "DRAPIXAI_GARMENT_FAST_PLAIN_BACKGROUND_MATTE" "0"
  upsert_env "DRAPIXAI_CANDIDATE_COUNT" "1"
  upsert_env "DRAPIXAI_MIN_QUALITY_SCORE" "0.95"
  upsert_env "DRAPIXAI_ENABLE_LOWER_BODY" "0"
  upsert_env "DRAPIXAI_ENABLE_REFINEMENT" "0"
  upsert_env "DRAPIXAI_ENABLE_UPSCALE" "0"
  upsert_env "DRAPIXAI_PRELOAD_MODEL" "1"
  upsert_env "DRAPIXAI_ENABLE_XFORMERS" "1"
  upsert_env "DRAPIXAI_ENABLE_TF32" "1"
  upsert_env "DRAPIXAI_ENABLE_VAE_TILING" "1"
  upsert_env "DRAPIXAI_ENABLE_CPU_OFFLOAD" "0"
  upsert_env "DRAPIXAI_OPENPOSE_DEVICE" "cuda"
  upsert_env "DRAPIXAI_LOW_VRAM" "0"
  upsert_env "DRAPIXAI_OUTPUT_FORMAT" "png"
  upsert_env "DRAPIXAI_ENABLE_FINAL_OUTPUT_UPSCALE" "1"
  upsert_env "DRAPIXAI_OUTPUT_WIDTH" "1024"
  upsert_env "DRAPIXAI_OUTPUT_HEIGHT" "1365"

  local current_token
  current_token="$(grep '^DRAPIXAI_ADMIN_TOKEN=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$current_token" || "$current_token" == "replace-with-a-long-random-secret" ]]; then
    upsert_env "DRAPIXAI_ADMIN_TOKEN" "$(generate_secret)"
  fi

  local current_ai_token
  current_ai_token="$(grep '^DRAPIXAI_AI_SERVICE_TOKEN=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$current_ai_token" || "$current_ai_token" == replace-with-* ]]; then
    upsert_env "DRAPIXAI_AI_SERVICE_TOKEN" "$(generate_secret)"
  fi

  local garment_cache_backend="${DRAPIXAI_GARMENT_CACHE_BACKEND:-local}"
  upsert_env "DRAPIXAI_GARMENT_CACHE_BACKEND" "$garment_cache_backend"
  if [[ "$garment_cache_backend" == "s3" ]]; then
    require_for_backend "DRAPIXAI_S3_BUCKET"
    require_for_backend "DRAPIXAI_S3_REGION"
    require_for_backend "DRAPIXAI_S3_ACCESS_KEY_ID"
    require_for_backend "DRAPIXAI_S3_SECRET_ACCESS_KEY"
    upsert_env "DRAPIXAI_S3_BUCKET" "$DRAPIXAI_S3_BUCKET"
    upsert_env "DRAPIXAI_S3_REGION" "$DRAPIXAI_S3_REGION"
    upsert_env "DRAPIXAI_S3_ACCESS_KEY_ID" "$DRAPIXAI_S3_ACCESS_KEY_ID"
    upsert_env "DRAPIXAI_S3_SECRET_ACCESS_KEY" "$DRAPIXAI_S3_SECRET_ACCESS_KEY"
  else
    upsert_env "DRAPIXAI_S3_BUCKET" "${DRAPIXAI_S3_BUCKET:-drapixai-runpod-local}"
    upsert_env "DRAPIXAI_S3_REGION" "${DRAPIXAI_S3_REGION:-us-east-1}"
    upsert_env "DRAPIXAI_S3_ACCESS_KEY_ID" ""
    upsert_env "DRAPIXAI_S3_SECRET_ACCESS_KEY" ""
  fi
}

load_env() {
  log "Loading AI env"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

create_runtime_dirs() {
  log "Creating runtime directories"
  mkdir -p \
    "$APP_ROOT/models" \
    "$APP_ROOT/runtime/logs" \
    "$APP_ROOT/runtime/garments" \
    "$APP_ROOT/runtime/cache/huggingface" \
    "$APP_ROOT/runtime/cache/torch" \
    "$APP_ROOT/runtime/cache/u2net" \
    "$APP_ROOT/runtime/test_assets" \
    "$APP_ROOT/runtime/catvton_smoke" \
    "$APP_ROOT/runtime/test_matrix"
}

install_python_stack() {
  log "Installing DrapixAI Python stack"
  cd "$APP_ROOT"
  python - <<'PY'
import sys

if sys.version_info[:2] != (3, 11):
    raise SystemExit(
        f"Python {sys.version_info.major}.{sys.version_info.minor} detected. "
        "Use RunPod image runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04 "
        "for the DrapixAI production CatVTON stack."
    )
PY
  if [[ -f .gitmodules ]]; then
    git submodule update --init --recursive
  fi
  python -m pip install --upgrade pip setuptools wheel
  python -m pip install -r drapixai_ai/requirements.txt
}

download_models_if_needed() {
  if [[ "$SKIP_MODEL_DOWNLOAD" == "1" ]]; then
    log "Skipping model download because DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD=1"
    return
  fi
  log "Preparing CatVTON model assets"
  cd "$APP_ROOT"
  python -m drapixai_ai.scripts.download_catvton
  python -m drapixai_ai.scripts.prepare_catvton
}

run_preflight() {
  log "Running preflight"
  cd "$APP_ROOT"
  bash deploy/runpod/preflight.sh "$ENV_FILE"
}

start_services() {
  if [[ "$RUN_START" != "1" ]]; then
    log "Skipping service start because DRAPIXAI_SETUP_START_SERVICES=$RUN_START"
    return
  fi

  log "Starting DrapixAI AI services in background"
  cd "$APP_ROOT"
  pkill -f "uvicorn.*drapixai_ai" 2>/dev/null || true
  pkill -f "drapixai_ai.worker.gpu_worker" 2>/dev/null || true
  pkill -f "rq worker" 2>/dev/null || true
  if ! redis-cli ping >/dev/null 2>&1; then
    bash deploy/runpod/start-redis.sh
  fi
  nohup bash deploy/runpod/start-all.sh > "$APP_ROOT/runtime/logs/start-all.log" 2>&1 &

  for _ in {1..90}; do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      log "AI API health check passed on port $PORT"
      return
    fi
    sleep 2
  done

  echo "AI API did not become healthy. Showing service log:" >&2
  tail -n 200 "$APP_ROOT/runtime/logs/start-all.log" >&2 || true
  exit 1
}

run_smoke_if_requested() {
  if [[ "$RUN_SMOKE" != "1" ]]; then
    log "Skipping smoke test because DRAPIXAI_SETUP_RUN_SMOKE=$RUN_SMOKE"
    return
  fi
  log "Running smoke try-on test"
  cd "$APP_ROOT"
  python deploy/runpod/smoke_tryon.py
}

print_success() {
  cat <<EOF

============================================================
DrapixAI fresh RunPod setup complete
============================================================

Repo:
  $APP_ROOT

Env:
  $ENV_FILE

Logs:
  $APP_ROOT/runtime/logs/start-all.log
  $LOG_FILE

Health checks:
  curl http://127.0.0.1:${PORT}/health
  curl http://127.0.0.1:${PORT}/ready

Process checks:
  pgrep -af "redis-server|uvicorn|gpu_worker|rq worker"
  nvidia-smi

Smoke test:
  Put person.jpg and garment.jpg in:
    $APP_ROOT/runtime/test_assets
  Then run:
    cd $APP_ROOT
    python deploy/runpod/smoke_tryon.py

To rerun setup:
  bash $APP_ROOT/deploy/runpod/setup-fresh-runpod.sh

To skip model download next time:
  DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD=1 bash $APP_ROOT/deploy/runpod/setup-fresh-runpod.sh

To keep an already-reviewed local source overlay without Git fetch/pull:
  DRAPIXAI_SETUP_SKIP_REPO_SYNC=1 bash $APP_ROOT/deploy/runpod/setup-fresh-runpod.sh

To setup without starting services:
  DRAPIXAI_SETUP_START_SERVICES=0 bash $APP_ROOT/deploy/runpod/setup-fresh-runpod.sh

EOF
}

main() {
  mkdir -p "$(dirname "$LOG_FILE")"
  exec > >(tee -a "$LOG_FILE") 2>&1

  log "Starting DrapixAI fresh RunPod setup"
  install_system_packages
  sync_repo
  create_runtime_dirs
  ensure_env_file
  load_env
  ensure_python_venv
  install_python_stack
  load_env
  download_models_if_needed
  run_preflight
  start_services
  run_smoke_if_requested
  print_success
}

main "$@"
