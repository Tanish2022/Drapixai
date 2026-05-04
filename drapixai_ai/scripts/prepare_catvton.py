from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATVTON = ROOT / "third_party" / "CatVTON"
CATVTON_REPO_URL = os.getenv("DRAPIXAI_CATVTON_GIT_URL", "https://github.com/Zheng-Chong/CatVTON.git")


def ensure_checkout() -> None:
    if (CATVTON / "model" / "pipeline.py").exists():
        return
    CATVTON.parent.mkdir(parents=True, exist_ok=True)
    if CATVTON.exists():
        raise RuntimeError(f"CatVTON directory exists but is incomplete: {CATVTON}")
    subprocess.run(["git", "clone", "--depth", "1", CATVTON_REPO_URL, str(CATVTON)], check=True)


def main() -> int:
    ensure_checkout()
    print(f"CatVTON dependency prepared at {CATVTON}")
    print("Install CatVTON Python requirements on the target GPU image if they are not already present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
