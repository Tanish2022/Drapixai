FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV HF_HOME=/workspace/.cache/huggingface
ENV TRANSFORMERS_CACHE=/workspace/.cache/huggingface
ENV DRAPIXAI_APP_ROOT=/workspace/drapixai
ENV DRAPIXAI_TRYON_ENGINE=catvton
ENV DRAPIXAI_CATVTON_MODEL_DIR=/workspace/drapixai/models/catvton
ENV DRAPIXAI_MODEL_DIR=/workspace/drapixai/models/catvton
ENV DRAPIXAI_GARMENT_CACHE_DIR=/workspace/drapixai/runtime/garments
ENV DRAPIXAI_GPU_PRESET=runpod-a100

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

COPY drapixai_ai/requirements.txt /tmp/requirements.txt

RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install -r /tmp/requirements.txt

COPY drapixai_ai /workspace/drapixai/drapixai_ai
COPY deploy /workspace/drapixai/deploy

RUN mkdir -p /workspace/drapixai/models /workspace/drapixai/runtime/logs /workspace/drapixai/runtime/garments /workspace/.cache/huggingface

ENV PYTHONPATH=/workspace/drapixai

EXPOSE 8080

CMD ["bash", "/workspace/drapixai/deploy/runpod/start-all.sh"]
