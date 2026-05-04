#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ENV_FILE="${1:-$DRAPIXAI_APP_ROOT/deploy/env/ai.production.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

bash "$SCRIPT_DIR/../scripts/validate-env.sh" ai

echo "== GPU =="
nvidia-smi || true

echo
echo "== Python =="
python --version

echo
echo "== Disk =="
df -h "$DRAPIXAI_APP_ROOT" || true

echo
echo "== Key Paths =="
echo "APP_ROOT=$DRAPIXAI_APP_ROOT"
echo "MODEL_DIR=$DRAPIXAI_MODEL_DIR"
echo "GARMENT_CACHE_DIR=$DRAPIXAI_GARMENT_CACHE_DIR"
echo "HF_HOME=$HF_HOME"
echo "TORCH_HOME=$TORCH_HOME"
echo "U2NET_HOME=$U2NET_HOME"

[[ -d "$DRAPIXAI_MODEL_DIR" ]] || { echo "Missing model directory: $DRAPIXAI_MODEL_DIR" >&2; exit 1; }
[[ -f "$DRAPIXAI_MODEL_DIR/mix-48k-1024/attention/model.safetensors" ]] || {
  echo "Missing CatVTON mix attention weights under $DRAPIXAI_MODEL_DIR" >&2
  exit 1
}
[[ -f "$DRAPIXAI_MODEL_DIR/DensePose/model_final_162be9.pkl" ]] || {
  echo "Missing CatVTON DensePose checkpoint under $DRAPIXAI_MODEL_DIR" >&2
  exit 1
}
[[ -f "$DRAPIXAI_MODEL_DIR/SCHP/exp-schp-201908261155-lip.pth" ]] || {
  echo "Missing CatVTON SCHP checkpoint under $DRAPIXAI_MODEL_DIR" >&2
  exit 1
}

echo
echo "== Torch / CUDA =="
python - <<'PY'
import torch
print(f"torch={torch.__version__}")
print(f"cuda_available={torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"cuda_device_count={torch.cuda.device_count()}")
    print(f"cuda_device_name={torch.cuda.get_device_name(0)}")
PY

echo
echo "== Pinned Python Stack =="
python - <<'PY'
from importlib import metadata


def version_tuple(value):
    parts = []
    for raw in value.replace("-", ".").split("."):
        digits = "".join(ch for ch in raw if ch.isdigit())
        if digits == "":
            break
        parts.append(int(digits))
    return tuple(parts)

expected = {
    "torch": "2.4.0",
    "torchvision": "0.19.0",
    "xformers": "0.0.27.post2",
    "fastapi": "0.115.0",
    "uvicorn": "0.30.6",
    "redis": "5.0.8",
    "rq": "1.16.2",
    "python-multipart": "0.0.9",
    "requests": "2.32.3",
    "boto3": "1.34.131",
    "accelerate": "0.34.2",
    "transformers": "4.46.3",
    "diffusers": "0.31.0",
    "safetensors": None,
    "einops": "0.7.0",
    "pillow": "10.3.0",
    "numpy": "1.26.4",
    "opencv-python": "4.10.0.84",
    "scipy": "1.13.1",
    "scikit-image": "0.24.0",
    "matplotlib": "3.9.1",
    "PyYAML": "6.0.1",
    "tqdm": "4.66.4",
    "rembg": "2.0.57",
    "onnxruntime": "1.23.2",
    "fvcore": "0.1.5.post20221221",
    "cloudpickle": "3.0.0",
    "omegaconf": "2.3.0",
    "pycocotools": "2.0.8",
    "av": "12.3.0",
}

errors = []
for package, wanted in expected.items():
    try:
        found = metadata.version(package)
    except metadata.PackageNotFoundError:
        errors.append(f"{package}: missing, expected {wanted}")
        continue
    print(f"{package}={found}")
    if wanted is not None and found != wanted:
        errors.append(f"{package}: found {found}, expected {wanted}")

try:
    hub_version = metadata.version("huggingface_hub")
    print(f"huggingface_hub={hub_version}")
    if not ((0, 34, 0) <= version_tuple(hub_version) < (2, 0)):
        errors.append(f"huggingface_hub: found {hub_version}, expected >=0.34.0,<2.0")
except metadata.PackageNotFoundError:
    errors.append("huggingface_hub: missing, expected >=0.34.0,<2.0")

try:
    peft_version = metadata.version("peft")
    print(f"peft={peft_version}")
    if peft_version != "0.17.0":
        errors.append(f"peft: found {peft_version}, expected 0.17.0")
except metadata.PackageNotFoundError:
    errors.append("peft: missing, expected 0.17.0")

if errors:
    print("Pinned package mismatch:")
    for error in errors:
        print(f"- {error}")
    raise SystemExit(1)
PY

echo
echo "== Redis target =="
echo "$DRAPIXAI_REDIS_URL"

echo
echo "Preflight passed. Next:"
echo "1. bash deploy/runpod/start-all.sh"
echo "2. curl http://127.0.0.1:8080/health"
echo "3. curl http://127.0.0.1:8080/ready"
