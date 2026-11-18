"""Contrived unit-test records; never evidence for a real benchmark or model."""
from __future__ import annotations

from drapixai_ai.services.lower_body_artifacts import EXPECTED_MODEL_REVISIONS, REQUIRED_MODEL_FILES, canonical_sha256
from drapixai_ai.services.lower_body_runtime import EXPECTED_PACKAGES, EXPECTED_SOURCE_ARCHIVES


def runtime_facts() -> dict[str, object]:
    return {
        "python": [3, 12], "packages": dict(EXPECTED_PACKAGES),
        "installed_packages": dict(EXPECTED_PACKAGES),
        "source_archives": dict(EXPECTED_SOURCE_ARCHIVES),
        "cuda_available": True, "cuda_runtime": "12.8", "gpu": "NVIDIA A100 80GB PCIe",
        "total_vram_bytes": 80 * 1024 ** 3, "gpu_arch": "sm_80", "torch_arches": ["sm_80", "sm_120"],
        "bf16_supported": True, "onnxruntime_providers": ["CUDAExecutionProvider", "CPUExecutionProvider"],
    }


def model_identity() -> dict[str, object]:
    model = {
        "schema_version": 1,
        **{section: {"repo_id": repo_id, "revision": revision} for section, (repo_id, revision) in EXPECTED_MODEL_REVISIONS.items()},
        "files": {relative: {"sha256": "a" * 64, "size": 10} for relative in REQUIRED_MODEL_FILES},
    }
    return {**model, "identity_sha256": canonical_sha256(model)}


def run_context() -> dict[str, object]:
    return {
        "schema_version": 1, "release_commit": "a" * 40,
        "image": "unit-test.invalid/lower@sha256:" + "b" * 64,
        "model_loaded": True,
        "pose_session_providers": {name: ["CUDAExecutionProvider", "CPUExecutionProvider"] for name in ("session_det", "session_pose")},
        "runtime_facts": runtime_facts(), "model_identity": model_identity(),
        "settings": {"lower_body_engine": "fashn_vton", "fashn_num_timesteps": 50},
        "source_files": {"drapixai_ai/pipeline/unit_only.py": "c" * 64},
    }
