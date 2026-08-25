# syntax=docker/dockerfile:1.7
# Compile Python wheels against the digest-pinned CUDA devel image, then serve
# shoppers from the matching runtime image so compilers and profiling tools are
# not part of the production attack surface.
ARG DRAPIXAI_AI_BUILD_IMAGE=pytorch/pytorch:2.11.0-cuda12.8-cudnn9-devel@sha256:53ab3de62f6101d1e42f9be28623ab7a468a24c070d632f211ed576e30b6abd3
ARG DRAPIXAI_AI_BASE_IMAGE=pytorch/pytorch:2.11.0-cuda12.8-cudnn9-runtime@sha256:eee11b3b3872a8c838e35ef48f08b2d5def2080902c7f666831310ca1a0ef2be
ARG DRAPIXAI_AI_REQUIREMENTS_FILE=drapixai_ai/requirements.rtx-pro-6000.txt

FROM ${DRAPIXAI_AI_BUILD_IMAGE} AS builder

ARG DRAPIXAI_AI_REQUIREMENTS_FILE

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/drapixai-venv \
    PATH=/opt/drapixai-venv/bin:$PATH

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/drapixai

COPY ${DRAPIXAI_AI_REQUIREMENTS_FILE} /tmp/requirements.txt

RUN /usr/bin/python3 -m venv --system-site-packages "$VIRTUAL_ENV" \
    && /usr/bin/python3 -m pip uninstall -y spin \
    && python -m pip install --upgrade pip==26.2.1 setuptools==81.0.0 wheel==0.48.0 \
    && python -m pip install -r /tmp/requirements.txt \
    && python -m pip check

FROM ${DRAPIXAI_AI_BASE_IMAGE}

LABEL org.opencontainers.image.title="DrapixAI CatVTON runtime" \
      org.opencontainers.image.description="RTX PRO 6000 Blackwell Standard CatVTON runtime"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/drapixai-venv \
    PATH=/opt/drapixai-venv/bin:$PATH \
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
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        curl \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && apt-get autoremove -y \
    && apt-get purge -y linux-libc-dev \
    && apt-get clean \
    && rm -rf \
        /var/lib/apt/lists/* \
        /opt/nvidia/nsight-compute \
        /opt/nvidia/nsight-systems \
        /usr/local/cuda-*/libnvvp \
        /usr/local/bin/uv \
        /usr/local/bin/uvx \
        /usr/local/bin/spin \
        /usr/local/lib/python3.12/dist-packages/PIL \
        /usr/local/lib/python3.12/dist-packages/pillow-* \
        /usr/local/lib/python3.12/dist-packages/msgpack \
        /usr/local/lib/python3.12/dist-packages/msgpack-* \
        /usr/local/lib/python3.12/dist-packages/setuptools \
        /usr/local/lib/python3.12/dist-packages/setuptools-* \
        /usr/local/lib/python3.12/dist-packages/spin \
        /usr/local/lib/python3.12/dist-packages/spin-* \
        /usr/local/lib/python3.12/dist-packages/urllib3 \
        /usr/local/lib/python3.12/dist-packages/urllib3-* \
        /usr/local/lib/python3.12/dist-packages/uv-*

WORKDIR /workspace/drapixai

COPY --from=builder /opt/drapixai-venv /opt/drapixai-venv

RUN python - <<'PY'
import sys
from importlib.metadata import version
from pathlib import Path

import msgpack
import PIL
import torch
import torchvision
import urllib3

if sys.version_info[:2] != (3, 12):
    raise SystemExit(f'Unexpected Python version: {sys.version}')
if torch.__version__.split('+', 1)[0] != '2.11.0':
    raise SystemExit(f'Unexpected Torch version: {torch.__version__}')
if torchvision.__version__.split('+', 1)[0] != '0.26.0':
    raise SystemExit(f'Unexpected torchvision version: {torchvision.__version__}')
if not (torch.version.cuda or '').startswith('12.8'):
    raise SystemExit(f'Unexpected CUDA runtime: {torch.version.cuda}')

venv = Path('/opt/drapixai-venv').resolve()
for module in (PIL, msgpack, urllib3):
    module_path = Path(module.__file__).resolve()
    if not module_path.is_relative_to(venv):
        raise SystemExit(f'Runtime dependency escaped the patched venv: {module_path}')

for distribution, expected in {
    'msgpack': '1.2.1',
    'pillow': '12.3.0',
    'urllib3': '2.7.0',
}.items():
    installed = version(distribution)
    if installed != expected:
        raise SystemExit(f'Unexpected {distribution} version: {installed}')
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

CMD ["bash", "/workspace/drapixai/deploy/runpod/start-ai-api.sh"]
