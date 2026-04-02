from __future__ import annotations

import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IDM_VTON = ROOT / "third_party" / "IDM-VTON"

BODY_FILE = IDM_VTON / "preprocess" / "openpose" / "annotator" / "openpose" / "body.py"

BODY_PATCH_OLD = """class Body(object):
    def __init__(self, model_path):
        self.model = bodypose_model()
        if torch.cuda.is_available():
            self.model = self.model.cuda()
            # print('cuda')
        model_dict = util.transfer(self.model, torch.load(model_path))
"""

BODY_PATCH_NEW = """class Body(object):
    def __init__(self, model_path):
        openpose_device = os.getenv("DRAPIXAI_OPENPOSE_DEVICE", "cuda").strip().lower()
        use_cuda = torch.cuda.is_available() and openpose_device != "cpu"
        self.device = "cuda" if use_cuda else "cpu"
        self.model = bodypose_model()
        self.model = self.model.to(self.device)
        model_dict = util.transfer(self.model, torch.load(model_path, map_location=self.device))
"""

BODY_PATCH_DATA_OLD = """            data = torch.from_numpy(im).float()
            if torch.cuda.is_available():
                data = data.cuda()
"""

BODY_PATCH_DATA_NEW = """            data = torch.from_numpy(im).float()
            data = data.to(self.device)
"""

ASSETS = {
    IDM_VTON / "ckpt" / "humanparsing" / "parsing_atr.onnx": {
        "url": "https://huggingface.co/spaces/yisol/IDM-VTON/resolve/main/ckpt/humanparsing/parsing_atr.onnx",
        "min_bytes": 1024 * 1024,
    },
    IDM_VTON / "ckpt" / "humanparsing" / "parsing_lip.onnx": {
        "url": "https://huggingface.co/spaces/yisol/IDM-VTON/resolve/main/ckpt/humanparsing/parsing_lip.onnx",
        "min_bytes": 1024 * 1024,
    },
    IDM_VTON / "ckpt" / "openpose" / "ckpts" / "body_pose_model.pth": {
        "url": "https://huggingface.co/lllyasviel/Annotators/resolve/main/body_pose_model.pth",
        "min_bytes": 1024 * 1024,
    },
}


def ensure_dependency_checkout() -> None:
    if not IDM_VTON.exists():
        raise RuntimeError(
            "IDM-VTON checkout is missing. Run 'git submodule update --init --recursive' before preparing assets."
        )


def patch_body_file() -> None:
    if not BODY_FILE.exists():
        raise RuntimeError(f"Expected IDM-VTON body.py at {BODY_FILE}")

    content = BODY_FILE.read_text(encoding="utf-8")
    updated = content

    if "import os" not in updated:
        updated = updated.replace("import time\n", "import time\nimport os\n", 1)

    if 'openpose_device = os.getenv("DRAPIXAI_OPENPOSE_DEVICE", "cuda").strip().lower()' not in updated:
        if BODY_PATCH_OLD not in updated:
            raise RuntimeError("Unable to apply DrapixAI OpenPose device patch: upstream body.py layout changed.")
        updated = updated.replace(BODY_PATCH_OLD, BODY_PATCH_NEW, 1)

    if "data = data.to(self.device)" not in updated:
        if BODY_PATCH_DATA_OLD not in updated:
            raise RuntimeError("Unable to apply DrapixAI tensor device patch: upstream body.py layout changed.")
        updated = updated.replace(BODY_PATCH_DATA_OLD, BODY_PATCH_DATA_NEW, 1)

    if updated != content:
        BODY_FILE.write_text(updated, encoding="utf-8")


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response, destination.open("wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)


def ensure_asset(path: Path, url: str, min_bytes: int) -> None:
    if path.exists() and path.stat().st_size >= min_bytes:
        return
    print(f"Downloading {path.name} ...")
    download(url, path)
    if path.stat().st_size < min_bytes:
        raise RuntimeError(f"Downloaded asset is unexpectedly small: {path}")


def main() -> int:
    ensure_dependency_checkout()
    patch_body_file()
    for path, spec in ASSETS.items():
        ensure_asset(path, spec["url"], spec["min_bytes"])
    print("IDM-VTON dependency prepared.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
