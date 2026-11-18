from __future__ import annotations

import re
from pathlib import Path

from drapixai_ai.services.lower_body_artifacts import EXPECTED_MODEL_REVISIONS, REQUIRED_MODEL_FILES, canonical_sha256, sha256_file, verify_lower_body_artifacts
from drapixai_ai.services.lower_body_runtime import collect_runtime_facts, validate_runtime_facts


def validate_run_context(context: object, digest: object) -> bool:
    if not isinstance(context, dict) or context.get("schema_version") != 1:
        return False
    try:
        if canonical_sha256(context) != digest:
            return False
        if not re.fullmatch(r"[a-f0-9]{40}", context.get("release_commit", "")):
            return False
        if not re.fullmatch(r"[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}", context.get("image", "")):
            return False
        if validate_runtime_facts(context["runtime_facts"], "A100"):
            return False
        if context.get("model_loaded") is not True or not context.get("source_files"):
            return False
        providers = context.get("pose_session_providers") or {}
        if set(providers) != {"session_det", "session_pose"} or any(
            not isinstance(value, list) or not value or value[0] != "CUDAExecutionProvider"
            for value in providers.values()
        ):
            return False
        if any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in context["source_files"].values()):
            return False
        model = dict(context.get("model_identity") or {})
        identity_hash = model.pop("identity_sha256", None)
        if identity_hash != canonical_sha256(model) or not set(REQUIRED_MODEL_FILES).issubset(model.get("files") or {}):
            return False
        for section, (repo_id, revision) in EXPECTED_MODEL_REVISIONS.items():
            if model.get(section) != {"repo_id": repo_id, "revision": revision}:
                return False
        return context["settings"].get("lower_body_engine") in {"fashn", "fashn_vton", "fashn_vton_1_5"}
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def build_run_context(settings: object, app_root: Path, runtime_report: dict[str, object]) -> dict[str, object]:
    if runtime_report.get("schema_version") != 2 or runtime_report.get("valid") is not True:
        raise ValueError("VERIFIED_LOWER_RUNTIME_REPORT_REQUIRED")
    facts = runtime_report.get("runtime_facts")
    if not isinstance(facts, dict) or canonical_sha256(facts) != runtime_report.get("runtime_identity_sha256"):
        raise ValueError("RUNTIME_REPORT_IDENTITY_INVALID")
    if collect_runtime_facts() != facts:
        raise ValueError("RUNTIME_FACTS_CHANGED_SINCE_VERIFICATION")
    identity = verify_lower_body_artifacts(Path(settings.fashn_weights_dir))
    if identity != runtime_report.get("model_identity"):
        raise ValueError("RUNTIME_MODEL_IDENTITY_MISMATCH")
    selected = {
        name: value for name, value in vars(settings).items()
        if name.startswith(("lower_body_", "fashn_", "garment_", "enable_"))
        or name in {
            "candidate_count", "min_quality_score", "input_max_side", "inference_steps", "guidance_scale",
            "device", "cuda_device_index", "output_width", "output_height", "output_format",
            "natural_lighting_strength", "fashion_polish_strength", "person_context_restore_strength",
            "background_color_cast_threshold",
        }
    }
    for name in ("fashn_weights_dir", "garment_cache_dir"):
        selected.pop(name, None)
    source_files = {}
    for directory in ("configs", "engines", "pipeline", "preprocess", "postprocess", "quality", "services", "worker", "api"):
        for path in sorted((app_root / "drapixai_ai" / directory).rglob("*.py")):
            if path.is_symlink() or app_root.resolve() not in path.resolve().parents or not path.is_file():
                raise ValueError("RUN_SOURCE_FILE_UNSAFE")
            source_files[path.relative_to(app_root).as_posix()] = sha256_file(path)
    for relative in (
        "deploy/runpod/run_lower_body_matrix.py", "deploy/runpod/verify_lower_body_runtime.py",
        "drapixai_ai/scripts/download_fashn_vton.py",
    ):
        path = app_root / relative
        if path.is_symlink() or not path.is_file() or app_root.resolve() not in path.resolve().parents:
            raise ValueError("RUN_SOURCE_FILE_UNSAFE")
        source_files[relative] = sha256_file(path)
    context = {
        "schema_version": 1,
        "release_commit": runtime_report.get("release_commit"),
        "image": runtime_report.get("image"),
        "model_loaded": (runtime_report.get("model_load") or {}).get("loaded") is True,
        "pose_session_providers": (runtime_report.get("model_load") or {}).get("pose_session_providers"),
        "runtime_facts": facts,
        "model_identity": identity,
        "settings": selected,
        "source_files": source_files,
    }
    digest = canonical_sha256(context)
    if not validate_run_context(context, digest):
        raise ValueError("LOWER_BODY_RUN_CONTEXT_INVALID")
    return {"run_context": context, "run_context_sha256": digest}
