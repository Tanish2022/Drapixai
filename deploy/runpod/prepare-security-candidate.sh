#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
CANDIDATE_ROOT="${DRAPIXAI_SECURITY_CANDIDATE_ROOT:-$APP_ROOT/runtime/security-candidate}"
CANDIDATE_VENV="${DRAPIXAI_SECURITY_CANDIDATE_VENV:-$CANDIDATE_ROOT/.venv}"
AUDIT_VENV="${DRAPIXAI_SECURITY_AUDIT_VENV:-$CANDIDATE_ROOT/.audit-venv}"
PYTORCH_INDEX="${DRAPIXAI_PYTORCH_INDEX:-https://download.pytorch.org/whl/cu126}"
REQUIREMENTS="$APP_ROOT/drapixai_ai/requirements.security-candidate.txt"
RESET=0

if [[ "${1:-}" == "--reset" ]]; then
  RESET=1
elif [[ -n "${1:-}" ]]; then
  echo "Usage: $0 [--reset]" >&2
  exit 2
fi

if [[ ! -f "$REQUIREMENTS" ]]; then
  echo "Missing security-candidate requirements: $REQUIREMENTS" >&2
  exit 1
fi

PYTHON_BIN="${DRAPIXAI_PYTHON_BIN:-$(command -v python3.11 || true)}"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Python 3.11 is required for the security candidate." >&2
  exit 1
fi

if ! "$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)
PY
then
  echo "Security candidate requires Python 3.11 exactly." >&2
  exit 1
fi

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "nvidia-smi is required; this candidate must be prepared on the GPU host." >&2
  exit 1
fi

mkdir -p "$CANDIDATE_ROOT"
if [[ "$RESET" == "1" ]]; then
  "$PYTHON_BIN" -m venv --clear "$CANDIDATE_VENV"
elif [[ ! -x "$CANDIDATE_VENV/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$CANDIDATE_VENV"
fi

if [[ ! -x "$AUDIT_VENV/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$AUDIT_VENV"
fi

AUDIT_PYTHON="$AUDIT_VENV/bin/python"
"$AUDIT_PYTHON" -m pip install --quiet pip-audit==2.9.0
"$AUDIT_PYTHON" -m pip_audit \
  --requirement "$REQUIREMENTS" \
  --progress-spinner off \
  --ignore-vuln PYSEC-2026-2274 \
  --ignore-vuln GHSA-55v6-g8pm-pw4c \
  --ignore-vuln PYSEC-2026-3447

CANDIDATE_PYTHON="$CANDIDATE_VENV/bin/python"
export PIP_DISABLE_PIP_VERSION_CHECK=1

echo "Installing audited CUDA 12.6 core into isolated venv: $CANDIDATE_VENV"
"$CANDIDATE_PYTHON" -m pip install \
  --index-url "$PYTORCH_INDEX" \
  torch==2.12.1 \
  torchvision==0.27.1 \
  xformers==0.0.35

echo "Installing the remaining exact DrapixAI candidate pins from PyPI."
"$CANDIDATE_PYTHON" -m pip install -r "$REQUIREMENTS"
"$CANDIDATE_PYTHON" -m pip check

DRAPIXAI_SECURITY_REQUIREMENTS="$REQUIREMENTS" \
DRAPIXAI_SECURITY_REPORT="$CANDIDATE_ROOT/environment-report.json" \
"$CANDIDATE_PYTHON" - <<'PY'
from __future__ import annotations

import json
import os
import re
import subprocess
from importlib import metadata
from pathlib import Path

import torch
import xformers
import xformers.ops as xops

requirements_path = Path(os.environ["DRAPIXAI_SECURITY_REQUIREMENTS"])
report_path = Path(os.environ["DRAPIXAI_SECURITY_REPORT"])
expected: dict[str, str] = {}
for raw_line in requirements_path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "==" not in line:
        continue
    name, version = line.split("==", 1)
    expected[re.sub(r"[-_.]+", "-", name.split("[", 1)[0]).lower()] = version

installed: dict[str, str] = {}
errors: list[str] = []
for name, version in expected.items():
    found = metadata.version(name)
    installed[name] = found
    if found != version:
        errors.append(f"{name}: found {found}, expected {version}")

if not torch.cuda.is_available():
    errors.append("torch.cuda.is_available() is false")

kernel_ok = False
if not errors:
    query = torch.randn((1, 64, 8, 64), device="cuda", dtype=torch.float16)
    output = xops.memory_efficient_attention(query, query, query)
    torch.cuda.synchronize()
    kernel_ok = output.shape == query.shape and bool(torch.isfinite(output).all().item())
    if not kernel_ok:
        errors.append("xFormers memory-efficient attention kernel validation failed")

driver = subprocess.run(
    ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
    check=True,
    capture_output=True,
    text=True,
).stdout.strip().splitlines()[0]

report = {
    "status": "ready_for_a100_quality_gate" if not errors else "failed",
    "production_environment_changed": False,
    "torch_version": torch.__version__,
    "torch_cuda_runtime": torch.version.cuda,
    "cuda_available": torch.cuda.is_available(),
    "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    "driver": driver,
    "xformers_version": xformers.__version__,
    "xformers_kernel_ok": kernel_ok,
    "installed_direct_pins": installed,
    "errors": errors,
}
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
if errors:
    raise SystemExit(1)
PY

echo "Security candidate prepared without changing the production venv."
echo "Next gate: run the fixed direct/SDK pair and strict 50-case matrix with this venv."
