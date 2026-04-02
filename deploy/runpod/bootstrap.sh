#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:-/workspace/drapixai}"

APT_PREFIX=()
if [[ "$(id -u)" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "This script needs root or sudo access to install system packages." >&2
    exit 1
  fi
  APT_PREFIX=(sudo)
fi

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

cd "$APP_ROOT"

python -m pip install --upgrade pip setuptools wheel
python -m pip install -r drapixai_ai/requirements.txt

mkdir -p \
  "$APP_ROOT/models" \
  "$APP_ROOT/runtime/logs" \
  "$APP_ROOT/runtime/garments" \
  /workspace/.cache/huggingface

echo "Bootstrap complete. Next:"
echo "1. Copy deploy/env/ai.production.example to deploy/env/ai.production.env"
echo "2. Fill the secrets and model paths"
echo "3. Run: set -a && source deploy/env/ai.production.env && set +a"
echo "4. Run: bash deploy/runpod/start-all.sh"

