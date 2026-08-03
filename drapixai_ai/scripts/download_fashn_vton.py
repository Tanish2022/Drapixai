from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

MODEL_REVISION = "7720683168567eb5a2a4c67f15116c6e29c83ded"
DWPOSE_REVISION = "548b5df25b84d9f4aac0611dfa1c2a7a12f15571"
HUMAN_PARSER_REVISION = "1f80c34dbab321c5730dda5c3fea279fd3e97498"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Download pinned FASHN VTON lower-worker weights.")
    parser.add_argument("--weights-dir", type=Path, required=True)
    parser.add_argument("--model-revision", default=MODEL_REVISION)
    parser.add_argument("--dwpose-revision", default=DWPOSE_REVISION)
    parser.add_argument("--human-parser-revision", default=HUMAN_PARSER_REVISION)
    args = parser.parse_args()

    args.weights_dir.mkdir(parents=True, exist_ok=True)
    hf_hub_download(
        repo_id="fashn-ai/fashn-vton-1.5",
        filename="model.safetensors",
        revision=args.model_revision,
        local_dir=args.weights_dir,
    )
    for filename in ("yolox_l.onnx", "dw-ll_ucoco_384.onnx"):
        hf_hub_download(
            repo_id="fashn-ai/DWPose",
            filename=filename,
            revision=args.dwpose_revision,
            local_dir=args.weights_dir / "dwpose",
        )
    human_parser_snapshot = snapshot_download(
        repo_id="fashn-ai/fashn-human-parser",
        revision=args.human_parser_revision,
    )

    required = (
        args.weights_dir / "model.safetensors",
        args.weights_dir / "dwpose" / "yolox_l.onnx",
        args.weights_dir / "dwpose" / "dw-ll_ucoco_384.onnx",
    )
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"FASHN_WEIGHT_DOWNLOAD_INCOMPLETE:{','.join(missing)}")
    manifest = {
        "model": {
            "repo_id": "fashn-ai/fashn-vton-1.5",
            "revision": args.model_revision,
        },
        "dwpose": {
            "repo_id": "fashn-ai/DWPose",
            "revision": args.dwpose_revision,
        },
        "human_parser": {
            "repo_id": "fashn-ai/fashn-human-parser",
            "revision": args.human_parser_revision,
            "cached_snapshot": human_parser_snapshot,
        },
        "files": {
            str(path.relative_to(args.weights_dir)).replace("\\", "/"): {
                "size": path.stat().st_size,
                "sha256": _sha256(path),
            }
            for path in required
        },
    }
    manifest_path = args.weights_dir / "model-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    for path in required:
        print(f"{path} {path.stat().st_size} {_sha256(path)}")
    print(manifest_path)


if __name__ == "__main__":
    main()
