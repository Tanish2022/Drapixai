#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  DRAPIXAI_EXPECTED_GIT_REF=<40-character-release-commit> \
  DRAPIXAI_NVIDIA_CUDA_PROBE_IMAGE=<approved-image@sha256:...> \
  bash deploy/workstation/preflight.sh [deploy/env/ai.production.env]

This validates the on-premises RTX PRO 6000 production host before Compose starts.
It does not print secret values or start public services.
EOF
  exit 2
}

[[ $# -le 1 ]] || usage

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${1:-$repo_root/deploy/env/ai.production.env}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require_command git
require_command docker
require_command nvidia-smi
require_command python3

[[ -f "$env_file" ]] || {
  echo "Missing production AI environment file: $env_file" >&2
  exit 1
}

set -a
source "$env_file"
set +a

bash "$repo_root/deploy/scripts/validate-env.sh" ai

if [[ "${DRAPIXAI_GPU_PRESET:-}" != "rtx-pro-6000-blackwell" ]]; then
  echo "Production workstation must use DRAPIXAI_GPU_PRESET=rtx-pro-6000-blackwell" >&2
  exit 1
fi

expected_ref="${DRAPIXAI_EXPECTED_GIT_REF:-}"
[[ "$expected_ref" =~ ^[a-f0-9]{40}$ ]] || {
  echo "DRAPIXAI_EXPECTED_GIT_REF must be the exact 40-character release commit." >&2
  exit 1
}
expected_commit="$(git -C "$repo_root" rev-parse "${expected_ref}^{commit}" 2>/dev/null || true)"
current_commit="$(git -C "$repo_root" rev-parse HEAD)"
[[ -n "$expected_commit" && "$expected_commit" == "$current_commit" ]] || {
  echo "Workstation checkout does not match DRAPIXAI_EXPECTED_GIT_REF." >&2
  exit 1
}
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] || {
  echo "Production workstation checkout must be clean." >&2
  exit 1
}

gpu_name="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -n 1 | tr '[:upper:]' '[:lower:]')"
gpu_memory_mib="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | tr -dc '0-9')"
[[ "$gpu_name" =~ rtx.*pro.*6000 ]] || {
  echo "Expected RTX PRO 6000 GPU, found: $gpu_name" >&2
  exit 1
}
[[ "$gpu_memory_mib" =~ ^[0-9]+$ && "$gpu_memory_mib" -ge 90000 ]] || {
  echo "Expected at least 90000 MiB GPU memory, found: ${gpu_memory_mib:-unknown}" >&2
  exit 1
}

probe_image="${DRAPIXAI_NVIDIA_CUDA_PROBE_IMAGE:-}"
[[ "$probe_image" =~ @sha256:[a-f0-9]{64}$ ]] || {
  echo "DRAPIXAI_NVIDIA_CUDA_PROBE_IMAGE must be an approved digest-pinned CUDA image." >&2
  exit 1
}
docker run --rm --network none --read-only --gpus all "$probe_image" nvidia-smi -L >/dev/null

for required_path in \
  "$repo_root/models/model-lock.json" \
  "$repo_root/models/catvton/mix-48k-1024/attention/model.safetensors" \
  "$repo_root/models/catvton/DensePose/model_final_162be9.pkl" \
  "$repo_root/models/catvton/SCHP/exp-schp-201908261155-lip.pth"; do
  [[ -f "$required_path" ]] || {
    echo "Missing required model artifact: $required_path" >&2
    exit 1
  }
done

python3 "$repo_root/deploy/scripts/verify-standard-release-profile.py"
docker compose --env-file "$env_file" -f "$repo_root/deploy/docker-compose.ai.yml" config --quiet

free_bytes="$(df -PB1 "$repo_root" | awk 'NR == 2 { print $4 }')"
[[ "$free_bytes" =~ ^[0-9]+$ && "$free_bytes" -ge 214748364800 ]] || {
  echo "At least 200 GiB free disk is required for models, cache, images, and rollback." >&2
  exit 1
}

echo "RTX PRO 6000 production preflight passed."
echo "Commit: $current_commit"
echo "GPU: $gpu_name ($gpu_memory_mib MiB)"
echo "Next: start the private AI Compose stack, then run verify-private-listeners.sh and the staged certification suites."
