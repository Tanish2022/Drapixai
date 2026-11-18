from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

from drapixai_ai.services.lower_body_artifacts import EXPECTED_MODEL_REVISIONS, REQUIRED_MODEL_FILES

MODEL_REVISION = EXPECTED_MODEL_REVISIONS["model"][1]
DWPOSE_REVISION = EXPECTED_MODEL_REVISIONS["dwpose"][1]
HUMAN_PARSER_REVISION = EXPECTED_MODEL_REVISIONS["human_parser"][1]


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
    snapshot_download(
        repo_id="fashn-ai/fashn-human-parser",
        revision=args.human_parser_revision,
        local_dir=args.weights_dir / "human_parser",
        allow_patterns=["config.json", "model.safetensors"],
    )

    required = tuple(args.weights_dir / relative for relative in REQUIRED_MODEL_FILES)
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
            "local_directory": "human_parser",
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
