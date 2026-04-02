from __future__ import annotations

import os

target_dir_default = os.getenv("DRAPIXAI_MODEL_DIR", "models/idm_vton")
if not os.getenv("HF_HOME"):
    os.environ["HF_HOME"] = os.path.abspath(os.path.join(target_dir_default, "..", ".hf_cache"))
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

from huggingface_hub import snapshot_download


def main() -> None:
    repo_id = "yisol/IDM-VTON"
    target_dir = os.getenv("DRAPIXAI_MODEL_DIR", "models/idm_vton")
    snapshot_download(
        repo_id=repo_id,
        local_dir=target_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )
    print(f"Model downloaded to {target_dir}")


if __name__ == "__main__":
    main()
