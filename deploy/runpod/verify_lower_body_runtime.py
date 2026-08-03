from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


EXPECTED_PACKAGES = {
    "torch": "2.4.0",
    "torchvision": "0.19.0",
    "fashn-vton": "1.5.0",
    "fashn-human-parser": "0.1.1",
    "onnxruntime-gpu": "1.20.1",
    "opencv-python": "4.10.0.84",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the dedicated FASHN lower-body GPU runtime.")
    parser.add_argument("--weights-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--load-model", action="store_true")
    parser.add_argument("--required-gpu-substring", default="A100")
    args = parser.parse_args()
    errors: list[str] = []

    import onnxruntime as ort
    import torch

    packages = {}
    for name, expected in EXPECTED_PACKAGES.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            actual = None
        packages[name] = {"expected": expected, "actual": actual, "valid": actual == expected}
        if actual != expected:
            errors.append(f"PACKAGE_VERSION_MISMATCH:{name}:{actual}/{expected}")

    if not torch.cuda.is_available():
        errors.append("CUDA_UNAVAILABLE")
    elif args.required_gpu_substring.lower() not in torch.cuda.get_device_name(0).lower():
        errors.append(f"UNEXPECTED_GPU:{torch.cuda.get_device_name(0)}")
    if torch.cuda.is_available() and not torch.cuda.is_bf16_supported():
        errors.append("BF16_UNSUPPORTED")
    providers = ort.get_available_providers()
    if "CUDAExecutionProvider" not in providers:
        errors.append("ORT_CUDA_PROVIDER_UNAVAILABLE")

    manifest_path = args.weights_dir / "model-manifest.json"
    manifest = {}
    if not manifest_path.is_file():
        errors.append("MODEL_MANIFEST_MISSING")
    else:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not all(
            str((manifest.get(section) or {}).get("revision") or "").strip()
            for section in ("model", "dwpose", "human_parser")
        ):
            errors.append("MODEL_REVISION_MISSING")
        for relative, expected in dict(manifest.get("files") or {}).items():
            path = args.weights_dir / relative
            if not path.is_file():
                errors.append(f"MODEL_FILE_MISSING:{relative}")
                continue
            actual_hash = _sha256(path)
            if actual_hash != str((expected or {}).get("sha256") or ""):
                errors.append(f"MODEL_HASH_MISMATCH:{relative}")

    load_report: dict[str, object] = {"requested": args.load_model}
    if args.load_model and not errors:
        from drapixai_ai.engines.fashn_vton import FashnVTONEngine

        started = time.perf_counter()
        engine = FashnVTONEngine()
        engine.load()
        torch.cuda.synchronize()
        load_report.update(
            {
                "loaded": engine.loaded,
                "load_ms": int((time.perf_counter() - started) * 1000),
                "allocated_mb": int(torch.cuda.memory_allocated() / (1024 * 1024)),
                "reserved_mb": int(torch.cuda.memory_reserved() / (1024 * 1024)),
            }
        )

    report = {
        "valid": not errors,
        "errors": errors,
        "packages": packages,
        "cuda_available": torch.cuda.is_available(),
        "cuda_runtime": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "bf16_supported": torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        "onnxruntime_providers": providers,
        "weights_dir": str(args.weights_dir),
        "model_manifest": manifest,
        "model_load": load_report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(args.output)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
