from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATVTON = ROOT / "third_party" / "CatVTON"
CATVTON_REPO_URL = os.getenv("DRAPIXAI_CATVTON_GIT_URL", "https://github.com/Zheng-Chong/CatVTON.git")
CATVTON_GIT_BRANCH = os.getenv("DRAPIXAI_CATVTON_GIT_BRANCH", "edited")
CATVTON_GIT_COMMIT = os.getenv("DRAPIXAI_CATVTON_GIT_COMMIT", "7818397f25613beedb3d861a34769f607cfcf3b1")
PRODUCTION_PATCH = ROOT / "patches" / "catvton-local-vae.patch"


def ensure_checkout() -> None:
    if not (CATVTON / "model" / "pipeline.py").exists():
        CATVTON.parent.mkdir(parents=True, exist_ok=True)
        if CATVTON.exists():
            raise RuntimeError(f"CatVTON directory exists but is incomplete: {CATVTON}")
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", CATVTON_GIT_BRANCH, CATVTON_REPO_URL, str(CATVTON)],
            check=True,
        )

    actual_commit = subprocess.run(
        ["git", "-C", str(CATVTON), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if actual_commit != CATVTON_GIT_COMMIT:
        raise RuntimeError(f"CatVTON source revision mismatch: expected {CATVTON_GIT_COMMIT}, found {actual_commit}")


def apply_production_patch() -> None:
    if not PRODUCTION_PATCH.is_file():
        raise RuntimeError(f"Missing tracked CatVTON production patch: {PRODUCTION_PATCH}")

    pipeline_path = CATVTON / "model" / "pipeline.py"
    if pipeline_path.is_file():
        pipeline_source = pipeline_path.read_text(encoding="utf-8")
        has_local_vae_argument = 'vae_ckpt="stabilityai/sd-vae-ft-mse"' in pipeline_source
        loads_configured_vae = "AutoencoderKL.from_pretrained(vae_ckpt)" in pipeline_source
        if has_local_vae_argument and loads_configured_vae:
            return

    check = subprocess.run(
        ["git", "-C", str(CATVTON), "apply", "--check", str(PRODUCTION_PATCH)],
        capture_output=True,
        text=True,
    )
    if check.returncode == 0:
        subprocess.run(["git", "-C", str(CATVTON), "apply", str(PRODUCTION_PATCH)], check=True)
        return
    already_applied = subprocess.run(
        ["git", "-C", str(CATVTON), "apply", "--reverse", "--check", str(PRODUCTION_PATCH)],
        capture_output=True,
        text=True,
    )
    if already_applied.returncode != 0:
        raise RuntimeError(
            "CatVTON production patch does not apply cleanly and is not already applied: "
            f"{check.stderr.strip()}"
        )


def main() -> int:
    ensure_checkout()
    apply_production_patch()
    print(f"CatVTON dependency prepared at {CATVTON}")
    print("Install CatVTON Python requirements on the target GPU image if they are not already present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
