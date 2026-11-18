from __future__ import annotations

import hashlib
import json
import re
import stat
from pathlib import Path


EXPECTED_MODEL_REVISIONS = {
    "model": ("fashn-ai/fashn-vton-1.5", "7720683168567eb5a2a4c67f15116c6e29c83ded"),
    "dwpose": ("fashn-ai/DWPose", "548b5df25b84d9f4aac0611dfa1c2a7a12f15571"),
    "human_parser": ("fashn-ai/fashn-human-parser", "1f80c34dbab321c5730dda5c3fea279fd3e97498"),
}
REQUIRED_MODEL_FILES = (
    "model.safetensors",
    "dwpose/yolox_l.onnx",
    "dwpose/dw-ll_ucoco_384.onnx",
    "human_parser/config.json",
    "human_parser/model.safetensors",
)


class LowerBodyArtifactError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()


def _regular_file(root: Path, relative: str) -> Path:
    if relative.startswith("/") or "\\" in relative or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise LowerBodyArtifactError("MODEL_FILE_PATH_UNSAFE")
    path = root
    for component in relative.split("/"):
        path = path / component
        if path.is_symlink():
            raise LowerBodyArtifactError("MODEL_FILE_LINK_UNSUPPORTED")
    try:
        if root not in path.resolve().parents or not stat.S_ISREG(path.stat().st_mode):
            raise LowerBodyArtifactError("MODEL_FILE_NOT_REGULAR")
    except OSError as exc:
        raise LowerBodyArtifactError(f"MODEL_FILE_MISSING:{relative}") from exc
    return path


def verify_lower_body_artifacts(weights_dir: Path) -> dict[str, object]:
    root = weights_dir.resolve()
    path = _regular_file(root, "model-manifest.json")
    if path.stat().st_size > 1024 * 1024:
        raise LowerBodyArtifactError("MODEL_MANIFEST_TOO_LARGE")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise LowerBodyArtifactError("MODEL_MANIFEST_INVALID") from exc
    if not isinstance(manifest, dict):
        raise LowerBodyArtifactError("MODEL_MANIFEST_INVALID")
    identity: dict[str, object] = {"schema_version": 1, "files": {}}
    for section, (repo_id, revision) in EXPECTED_MODEL_REVISIONS.items():
        record = manifest.get(section)
        if not isinstance(record, dict) or record.get("repo_id") != repo_id or record.get("revision") != revision:
            raise LowerBodyArtifactError(f"MODEL_REVISION_MISMATCH:{section}")
        identity[section] = {"repo_id": repo_id, "revision": revision}
    files = manifest.get("files")
    if not isinstance(files, dict) or not set(REQUIRED_MODEL_FILES).issubset(files):
        raise LowerBodyArtifactError("MODEL_FILE_SET_INCOMPLETE")
    for relative, record in files.items():
        if not isinstance(relative, str) or not isinstance(record, dict):
            raise LowerBodyArtifactError("MODEL_FILE_RECORD_INVALID")
        expected = record.get("sha256")
        size = record.get("size")
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise LowerBodyArtifactError("MODEL_FILE_HASH_INVALID")
        if type(size) is not int or size <= 0:
            raise LowerBodyArtifactError("MODEL_FILE_SIZE_INVALID")
        file_path = _regular_file(root, relative)
        if file_path.stat().st_size != size or sha256_file(file_path) != expected:
            raise LowerBodyArtifactError(f"MODEL_FILE_INTEGRITY_FAILED:{relative}")
        identity["files"][relative] = {"sha256": expected, "size": size}
    return {**identity, "identity_sha256": canonical_sha256(identity)}
