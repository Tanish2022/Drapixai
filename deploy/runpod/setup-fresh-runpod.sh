#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
REPO_URL="${DRAPIXAI_REPO_URL:-https://github.com/Tanish2022/Drapixai.git}"
REPO_BRANCH="${DRAPIXAI_REPO_BRANCH:-main}"
ENV_FILE="${DRAPIXAI_AI_ENV_FILE:-$APP_ROOT/deploy/env/ai.production.env}"
PORT="${PORT:-8080}"
RUN_START="${DRAPIXAI_SETUP_START_SERVICES:-1}"
RUN_SMOKE="${DRAPIXAI_SETUP_RUN_SMOKE:-0}"
SKIP_MODEL_DOWNLOAD="${DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD:-0}"
LOG_FILE="/tmp/drapixai-fresh-runpod-setup.log"

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
  printf '4. Env file: cat %s\n' "$ENV_FILE"
  printf '5. AI logs: tail -n 200 %s/runtime/logs/*.log\n' "$APP_ROOT"
  printf '6. Port 8080: ss -ltnp | grep %s\n' "$PORT"
  printf '7. Redis: redis-cli ping\n'
  printf '\nCommon fixes:\n'
  printf '- If git clone failed, check network access and REPO_URL.\n'
  printf '- If apt failed, run: apt-get update\n'
  printf '- If pip/model download failed, check disk space and internet access.\n'
  printf '- If preflight says model files are missing, rerun with DRAPIXAI_SETUP_SKIP_MODEL_DOWNLOAD=0.\n'
  printf '- If port %s is busy, run: fuser -k %s/tcp\n' "$PORT" "$PORT"
  printf '- If Redis is down, run: redis-server --daemonize yes\n'
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

trap 'print_troubleshooting "$LINENO" "$BASH_COMMAND"' ERR

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
}

sync_repo() {
  log "Preparing DrapixAI repo at $APP_ROOT"
  mkdir -p "$(dirname "$APP_ROOT")"
  if [[ -d "$APP_ROOT/.git" ]]; then
    cd "$APP_ROOT"
    git fetch origin "$REPO_BRANCH"
    git checkout "$REPO_BRANCH"
    git pull --ff-only origin "$REPO_BRANCH"
  else
    if [[ -e "$APP_ROOT" ]]; then
      local backup_path="${APP_ROOT}.backup.$(date '+%Y%m%d%H%M%S')"
      log "Existing non-git path found. Moving it to $backup_path"
      mv "$APP_ROOT" "$backup_path"
    fi
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_ROOT"
    cd "$APP_ROOT"
  fi
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
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_env_file() {
  log "Creating and normalizing AI env file"
  cd "$APP_ROOT"
  mkdir -p "$(dirname "$ENV_FILE")"
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$APP_ROOT/deploy/env/ai.production.example" "$ENV_FILE"
  fi

  upsert_env "DRAPIXAI_GPU_PRESET" "runpod-a100"
  upsert_env "DRAPIXAI_DEVICE" "cuda"
  upsert_env "DRAPIXAI_CUDA_DEVICE" "0"
  upsert_env "DRAPIXAI_REDIS_URL" "redis://127.0.0.1:6379/0"
  upsert_env "DRAPIXAI_TRYON_ENGINE" "catvton"
  upsert_env "DRAPIXAI_MODEL_DIR" "$APP_ROOT/models/catvton"
  upsert_env "DRAPIXAI_CATVTON_MODEL_DIR" "$APP_ROOT/models/catvton"
  upsert_env "DRAPIXAI_GARMENT_CACHE_DIR" "$APP_ROOT/runtime/garments"
  upsert_env "DRAPIXAI_RUNTIME_CACHE_ROOT" "$APP_ROOT/runtime/cache"
  upsert_env "DRAPIXAI_INPUT_MAX_SIDE" "640"
  upsert_env "DRAPIXAI_INFERENCE_STEPS" "22"
  upsert_env "DRAPIXAI_GUIDANCE_SCALE" "2.5"
  upsert_env "DRAPIXAI_TARGET_TRYON_MS" "12000"
  upsert_env "DRAPIXAI_ENABLE_GARMENT_COLOR_FIX" "1"
  upsert_env "DRAPIXAI_GARMENT_COLOR_FIX_STRENGTH" "0.94"
  upsert_env "DRAPIXAI_ENABLE_NATURAL_LIGHTING_FIX" "1"
  upsert_env "DRAPIXAI_NATURAL_LIGHTING_STRENGTH" "0.55"
  upsert_env "DRAPIXAI_ENABLE_FASHION_POLISH" "1"
  upsert_env "DRAPIXAI_FASHION_POLISH_STRENGTH" "0.45"
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

  local current_token
  current_token="$(grep '^DRAPIXAI_ADMIN_TOKEN=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$current_token" || "$current_token" == "replace-with-a-long-random-secret" ]]; then
    upsert_env "DRAPIXAI_ADMIN_TOKEN" "$(generate_secret)"
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
    redis-server --daemonize yes
    sleep 2
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
  install_python_stack
  load_env
  download_models_if_needed
  run_preflight
  start_services
  run_smoke_if_requested
  print_success
}

main "$@"
