#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
requirements="drapixai_ai/requirements.rtx-pro-6000.security-candidate.txt"
dockerfile="drapixai_ai/docker/Dockerfile"

for command in docker git python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done

commit="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || {
  echo "Unable to resolve the exact candidate commit." >&2
  exit 2
}
[[ -z "$(git -C "$repo_root" status --porcelain)" ]] || {
  echo "The RTX security candidate requires a clean checkout." >&2
  exit 1
}

tag="${DRAPIXAI_RTX_SECURITY_CANDIDATE_TAG:-drapixai/ai:${commit}-rtx-security-candidate}"
[[ "$tag" == *security-candidate* && "$tag" != *:latest ]] || {
  echo "Candidate tag must contain security-candidate and must not use latest." >&2
  exit 2
}

output_dir="${DRAPIXAI_RTX_SECURITY_CANDIDATE_DIR:-$repo_root/runtime/security-candidate/rtx-pro-6000}"
mkdir -p "$output_dir"
output_dir="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$output_dir")"
allowed_root="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$repo_root/runtime/security-candidate")"
case "$output_dir/" in
  "$allowed_root"/*) ;;
  *) echo "Candidate evidence must remain under runtime/security-candidate." >&2; exit 2 ;;
esac

docker build \
  --file "$repo_root/$dockerfile" \
  --build-arg "DRAPIXAI_AI_REQUIREMENTS_FILE=$requirements" \
  --label "org.opencontainers.image.revision=$commit" \
  --label "ai.drapix.runtime-channel=rtx-security-candidate" \
  --tag "$tag" \
  "$repo_root"

image_id="$(docker image inspect "$tag" --format '{{.Id}}')"
image_revision="$(docker image inspect "$tag" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
runtime_channel="$(docker image inspect "$tag" --format '{{index .Config.Labels "ai.drapix.runtime-channel"}}')"
[[ "$image_revision" == "$commit" && "$runtime_channel" == "rtx-security-candidate" ]] || {
  echo "Candidate image provenance labels do not match the clean checkout." >&2
  exit 1
}

python3 - "$output_dir/build.json" "$commit" "$tag" "$image_id" "$requirements" <<'PY'
import datetime
import json
import pathlib
import sys

path, commit, tag, image_id, requirements = sys.argv[1:]
payload = {
    "status": "READY_FOR_GPU_CERTIFICATION",
    "release_commit": commit,
    "image": tag,
    "image_id": image_id,
    "requirements": requirements,
    "runtime_channel": "rtx-security-candidate",
    "production_tag_modified": False,
    "built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "required_next_gates": [
        "exact container image scan",
        "direct and SDK Standard quality parity",
        "three-tenant GPU concurrency and isolation",
        "rights-cleared strict 50-case matrix",
    ],
}
pathlib.Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(json.dumps(payload, indent=2))
PY

echo "Candidate built without replacing the production image tag."
echo "Scan this exact image, then run GPU quality certification before promotion: $tag"
