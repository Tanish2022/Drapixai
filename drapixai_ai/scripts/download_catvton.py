from __future__ import annotations

import os
import json
from pathlib import Path

target_dir_default = os.getenv("DRAPIXAI_CATVTON_MODEL_DIR", "models/catvton")
if not os.getenv("HF_HOME"):
    os.environ["HF_HOME"] = os.path.abspath(os.path.join(target_dir_default, "..", ".hf_cache"))
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from huggingface_hub import snapshot_download


def main() -> None:
    repo_id = os.getenv("DRAPIXAI_CATVTON_REPO_ID", "zhengchong/CatVTON")
    target_dir = os.getenv("DRAPIXAI_CATVTON_MODEL_DIR", "models/catvton")
    revision = os.getenv("DRAPIXAI_CATVTON_MODEL_REVISION", "2969fcf85fe62f2036605716f0b56f0b81d01d79")
    base_repo_id = os.getenv("DRAPIXAI_CATVTON_BASE_REPO_ID", "runwayml/stable-diffusion-inpainting")
    base_revision = os.getenv("DRAPIXAI_CATVTON_BASE_REVISION", "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb")
    base_target = os.getenv("DRAPIXAI_CATVTON_BASE_MODEL", "models/stable-diffusion-inpainting")
    vae_repo_id = os.getenv("DRAPIXAI_CATVTON_VAE_REPO_ID", "stabilityai/sd-vae-ft-mse")
    vae_revision = os.getenv("DRAPIXAI_CATVTON_VAE_REVISION", "31f26fdeee1355a5c34592e401dd41e45d25a493")
    vae_target = os.getenv("DRAPIXAI_CATVTON_VAE_MODEL", "models/sd-vae-ft-mse")

    downloads = (
        (repo_id, revision, target_dir),
        (base_repo_id, base_revision, base_target),
        (vae_repo_id, vae_revision, vae_target),
    )
    for model_id, model_revision, local_dir in downloads:
        snapshot_download(
            repo_id=model_id,
            revision=model_revision,
            local_dir=local_dir,
            local_dir_use_symlinks=False,
        )
        print(f"Pinned model downloaded: {model_id}@{model_revision} -> {local_dir}")

    lock_path = Path(target_dir).resolve().parent / "model-lock.json"
    lock_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "models": [
                    {"repo_id": model_id, "revision": model_revision, "path": str(Path(local_dir).resolve())}
                    for model_id, model_revision, local_dir in downloads
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Model lock written to {lock_path}")


if __name__ == "__main__":
    main()
