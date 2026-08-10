# syntax=docker/dockerfile:1.7
# Blackwell-native CUDA 12.8 / PyTorch 2.11.0 base. The digest is supplied by
# Compose and revalidated by the workstation preflight before production starts.
ARG DRAPIXAI_AI_BASE_IMAGE=pytorch/pytorch:2.11.0-cuda12.8-cudnn9-devel@sha256:53ab3de62f6101d1e42f9be28623ab7a468a24c070d632f211ed576e30b6abd3
FROM ${DRAPIXAI_AI_BASE_IMAGE}

LABEL org.opencontainers.image.title="DrapixAI CatVTON runtime" \
      org.opencontainers.image.description="RTX PRO 6000 Blackwell Standard CatVTON runtime"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HF_HOME=/workspace/.cache/huggingface \
    TRANSFORMERS_CACHE=/workspace/.cache/huggingface \
    DRAPIXAI_APP_ROOT=/workspace/drapixai \
    DRAPIXAI_TRYON_ENGINE=catvton \
    DRAPIXAI_CATVTON_MODEL_DIR=/workspace/drapixai/models/catvton \
    DRAPIXAI_MODEL_DIR=/workspace/drapixai/models/catvton \
    DRAPIXAI_GARMENT_CACHE_DIR=/workspace/drapixai/runtime/garments \
    DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell \
    DRAPIXAI_ENABLE_XFORMERS=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ffmpeg \
        git \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        libxrender1 \
        redis-server \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/drapixai

COPY drapixai_ai/requirements.rtx-pro-6000.txt /tmp/requirements.txt

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install -r /tmp/requirements.txt \
    && python -m pip check \
    && python - <<'PY'
import sys
import torch
import torchvision

if sys.version_info[:2] != (3, 12):
    raise SystemExit(f'Unexpected Python version: {sys.version}')
if torch.__version__.split('+', 1)[0] != '2.11.0':
    raise SystemExit(f'Unexpected Torch version: {torch.__version__}')
if torchvision.__version__.split('+', 1)[0] != '0.26.0':
    raise SystemExit(f'Unexpected torchvision version: {torchvision.__version__}')
if not (torch.version.cuda or '').startswith('12.8'):
    raise SystemExit(f'Unexpected CUDA runtime: {torch.version.cuda}')
PY

COPY drapixai_ai /workspace/drapixai/drapixai_ai
COPY deploy /workspace/drapixai/deploy

RUN mkdir -p /workspace/drapixai/models /workspace/drapixai/runtime/logs /workspace/drapixai/runtime/garments /workspace/.cache/huggingface \
    && groupadd --gid 10001 drapixai \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin drapixai \
    && chown -R 10001:10001 /workspace/drapixai/runtime /workspace/.cache

ENV PYTHONPATH=/workspace/drapixai

EXPOSE 8080

USER 10001:10001

CMD ["bash", "/workspace/drapixai/deploy/runpod/start-all.sh"]