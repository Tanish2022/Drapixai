#!/usr/bin/env python3
"""Build an OFFLINE review-only wheel; never install or change requirements."""
from __future__ import annotations

import argparse
import ast
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

VERSION = "1.11.0"
WHEEL_SHA256 = "a628fa6beb069b8e549460fc449135d5bd8d73e7a11fd09f0bc9fc4ace7f06f1"
MODELING_SHA256 = "421a88fba25d6a50791fb54ea52e7eefd3beb678d1a131055176c09a87e820d6"
SOURCE_URL = "https://files.pythonhosted.org/packages/77/85/85951bc0f9843e2c10baaa1b6657227056095de08f4d1eea7d8b423a6832/accelerate-1.11.0-py3-none-any.whl"
MODULE = "accelerate/utils/modeling.py"
DIST = "accelerate-1.11.0.dist-info"
BUILD = "1drapixai"
OLD = ("        checkpoint_files = sorted(list(set(index.values())))\n"
       "        checkpoint_files = [os.path.join(checkpoint_folder, f) for f in checkpoint_files]")
NEW = "        checkpoint_files = _drapixai_checkpoint_files(checkpoint_folder, index)"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def patched_source(source, guard):
    if sha256(source) != MODELING_SHA256:
        raise ValueError("UPSTREAM_LOADER_HASH_MISMATCH")
    text = source.decode("utf-8")
    if text.count(OLD) != 1 or text.count("def load_checkpoint_in_model(") != 1:
        raise ValueError("UPSTREAM_LOADER_CONTEXT_MISMATCH")
    # Keep the API and every tensor operation unchanged. Only shard-list
    # construction is replaced; the helper is inserted before that function.
    text = text.replace(OLD, NEW).replace(
        "def load_checkpoint_in_model(",
        "# DrapixAI review candidate: shard path validation; upstream license retained.\n"
        + guard.strip() + "\n\n\ndef load_checkpoint_in_model(",
    )
    ast.parse(text)
    return text.encode("utf-8")


def build(wheel: Path, output: Path):
    repo = Path(__file__).resolve().parents[3]
    allowed = (repo / "runtime/security-candidate").resolve()
    output = output.resolve()
    if not output.is_relative_to(allowed) or output == allowed:
        raise ValueError("CANDIDATE_OUTPUT_OUTSIDE_ISOLATED_DIRECTORY")
    data = wheel.read_bytes()
    if sha256(data) != WHEEL_SHA256:
        raise ValueError("UPSTREAM_WHEEL_HASH_MISMATCH")
    guard_file = Path(__file__).with_name("shard_guard.py")
    guard = guard_file.read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as original:
        names = original.namelist()
        if len(names) != len(set(names)) or any(n.endswith(("RECORD.jws", "RECORD.p7s")) for n in names):
            raise ValueError("UPSTREAM_WHEEL_LAYOUT_INVALID")
        files = {name: original.read(name) for name in names}
    files[MODULE] = patched_source(files[MODULE], guard.decode("utf-8"))
    files[f"{DIST}/WHEEL"] += f"Build: {BUILD}\n".encode()
    commit = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], timeout=10, text=True).strip()
    dirty = subprocess.check_output(["git", "-C", str(repo), "status", "--porcelain"], timeout=10, text=True)
    manifest = {
        "status": "REVIEW_CANDIDATE_NOT_APPROVED",
        "advisory": "PYSEC-2026-3804",
        "upstream_version": VERSION,
        "upstream_wheel_url": SOURCE_URL,
        "upstream_wheel_sha256": WHEEL_SHA256,
        "upstream_loader_sha256": MODELING_SHA256,
        "patched_loader_sha256": sha256(files[MODULE]),
        "guard_sha256": sha256(guard),
        "builder_sha256": sha256(Path(__file__).read_bytes()),
        "source_commit": commit,
        "source_dirty_entries": len(dirty.splitlines()),
        "scope": "shard-name-validation-in-load_checkpoint_in_model",
        "audit_exception_added": False,
        "production_requirements_modified": False,
        "required_next": ["independent patch review", "exact AI image build and scan",
                          "Standard SDK/direct GPU and visual parity", "50-case quality matrix",
                          "three-tenant baseline and four-request isolation/soak certification"],
    }
    # Preserve Apache license and upstream version metadata. No version bump is
    # used to evade advisory matching; the existing pip-audit gate stays red.
    files[f"{DIST}/DRAPIXAI_PATCH.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    record_name = f"{DIST}/RECORD"
    for name, content in sorted(files.items()):
        if name != record_name:
            digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode()
            writer.writerow([name, "sha256=" + digest, len(content)])
    writer.writerow([record_name, "", ""])
    files[record_name] = record.getvalue().encode()
    encoded = io.BytesIO()
    with zipfile.ZipFile(encoded, "w", compression=zipfile.ZIP_DEFLATED) as result:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 16, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            result.writestr(info, content)
    candidate = encoded.getvalue()
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"accelerate-{VERSION}-{BUILD}-py3-none-any.whl"
    if target.exists() and target.read_bytes() != candidate:
        raise ValueError("CANDIDATE_OUTPUT_ALREADY_EXISTS_WITH_DIFFERENT_BYTES")
    target.write_bytes(candidate)
    manifest["candidate_wheel_sha256"] = sha256(candidate)
    (output / "build.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.wheel, args.output_dir), indent=2))
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        # Do not expose checkpoint content or environment variables.
        parser.exit(1, f"Candidate build refused: {type(error).__name__}: {error}\n")


if __name__ == "__main__":
    main()
