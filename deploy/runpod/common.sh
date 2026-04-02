#!/usr/bin/env bash
set -euo pipefail

export DRAPIXAI_APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
export DRAPIXAI_MODEL_DIR="${DRAPIXAI_MODEL_DIR:-$DRAPIXAI_APP_ROOT/models/idm_vton}"
export DRAPIXAI_GARMENT_CACHE_DIR="${DRAPIXAI_GARMENT_CACHE_DIR:-$DRAPIXAI_APP_ROOT/runtime/garments}"
export DRAPIXAI_GPU_PRESET="${DRAPIXAI_GPU_PRESET:-runpod-a100}"
export PYTHONPATH="${DRAPIXAI_APP_ROOT}${PYTHONPATH:+:${PYTHONPATH}}"

mkdir -p \
  "$DRAPIXAI_APP_ROOT/models" \
  "$DRAPIXAI_APP_ROOT/runtime/logs" \
  "$DRAPIXAI_GARMENT_CACHE_DIR" \
  /workspace/.cache/huggingface

cd "$DRAPIXAI_APP_ROOT"

