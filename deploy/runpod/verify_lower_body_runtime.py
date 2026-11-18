from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.services.lower_body_artifacts import canonical_sha256, verify_lower_body_artifacts
from drapixai_ai.services.lower_body_runtime import collect_runtime_facts, validate_runtime_facts


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the dedicated FASHN lower-body GPU runtime.")
    parser.add_argument("--weights-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--load-model", action="store_true")
    parser.add_argument("--required-gpu-substring", default="A100")
    parser.add_argument("--release-commit", default=os.getenv("DRAPIXAI_RELEASE_COMMIT", ""))
    parser.add_argument("--image", default=os.getenv("DRAPIXAI_AI_RELEASE_IMAGE", ""))
    args = parser.parse_args()
    errors: list[str] = []

    facts: dict[str, object] = {}
    try:
        facts = collect_runtime_facts()
    except Exception:
        errors.append("GPU_RUNTIME_IMPORT_OR_QUERY_FAILED")
    errors.extend(validate_runtime_facts(facts, args.required_gpu_substring))
    if not re.fullmatch(r"[a-f0-9]{40}", args.release_commit):
        errors.append("RELEASE_COMMIT_REQUIRED")
    if not re.fullmatch(r"[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}", args.image):
        errors.append("IMMUTABLE_IMAGE_REQUIRED")
    model_identity = None
    try:
        model_identity = verify_lower_body_artifacts(args.weights_dir)
    except (ValueError, OSError):
        errors.append("MODEL_ARTIFACT_VERIFICATION_FAILED")

    load_report: dict[str, object] = {"requested": args.load_model}
    if args.load_model and not errors:
        import torch
        from drapixai_ai.engines.fashn_vton import FashnVTONEngine

        started = time.perf_counter()
        try:
            engine = FashnVTONEngine(weights_dir=str(args.weights_dir), device="cuda:0")
            engine.load()
            torch.cuda.synchronize()
            pose_model = engine.pipeline.pose_model.pose_estimation
            providers = {
                name: getattr(pose_model, name).get_providers()
                for name in ("session_det", "session_pose")
            }
            if any(not value or value[0] != "CUDAExecutionProvider" for value in providers.values()):
                errors.append("DWPose_CUDA_FALLBACK")
            load_report.update({
                "loaded": engine.loaded,
                "pose_session_providers": providers,
                "load_ms": int((time.perf_counter() - started) * 1000),
                "allocated_mb": int(torch.cuda.memory_allocated() / (1024 * 1024)),
                "reserved_mb": int(torch.cuda.memory_reserved() / (1024 * 1024)),
            })
        except Exception:
            errors.append("MODEL_LOAD_FAILED")

    report = {
        "schema_version": 2,
        "valid": not errors,
        "errors": errors,
        "release_commit": args.release_commit,
        "image": args.image,
        "runtime_facts": facts,
        "runtime_identity_sha256": canonical_sha256(facts),
        "model_identity": model_identity,
        "model_load": load_report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(args.output)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
