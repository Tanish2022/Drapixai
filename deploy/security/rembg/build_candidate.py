#!/usr/bin/env python3
"""Build an offline SAM-name validation backport; review only, never install."""
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

VERSION = "2.0.69"
WHEEL_SHA256 = "39521967e4d2d6fa304ddd1a5df06d523501e6617cc5874f6cbf1256b6696080"
SAM_SHA256 = "89a3f6a8092d8a6579848d6b3ba210c06642b8fcecb7247aeaa98cf0fbca1925"
SOURCE_URL = "https://files.pythonhosted.org/packages/0c/ac/bade7f6ef1694c82c424129f0e35262b1578984ac1f716780fbf4930c9c3/rembg-2.0.69-py3-none-any.whl"
MODULE = "rembg/sessions/sam.py"
DIST = f"rembg-{VERSION}.dist-info"
BUILD = "1drapixai"
ANCHOR = '        model_name = kwargs.get("sam_model", "sam_vit_b_01ec64")\n'
# Same supported SAM names as upstream 2.0.82. Keep the default, quantization,
# download and tensor logic unchanged. Validate before any URL/path is formed.
GUARD = '''        if not isinstance(model_name, str) or model_name not in {
            "sam_vit_b_01ec64", "sam_vit_l_0b3195", "sam_vit_h_4b8939",
        }:
            raise ValueError("DRAPIXAI_UNSUPPORTED_SAM_MODEL")
'''


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def patch(source: bytes) -> bytes:
    if digest(source) != SAM_SHA256:
        raise ValueError("UPSTREAM_SAM_HASH_MISMATCH")
    text = source.decode("utf-8")
    if text.count(ANCHOR) != 1:
        raise ValueError("UPSTREAM_SAM_CONTEXT_MISMATCH")
    result = text.replace(ANCHOR, ANCHOR + GUARD).encode("utf-8")
    ast.parse(result)
    return result


def build(wheel: Path, output: Path) -> dict:
    root = Path(__file__).resolve().parents[3]
    allowed = (root / "runtime/security-candidate").resolve()
    output = output.resolve()
    if output == allowed or not output.is_relative_to(allowed):
        raise ValueError("CANDIDATE_OUTPUT_OUTSIDE_ISOLATED_DIRECTORY")
    raw = wheel.read_bytes()
    if digest(raw) != WHEEL_SHA256:
        raise ValueError("UPSTREAM_WHEEL_HASH_MISMATCH")
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(n.endswith(("RECORD.jws", "RECORD.p7s")) for n in names):
            raise ValueError("UPSTREAM_WHEEL_LAYOUT_INVALID")
        files = {name: archive.read(name) for name in names}
    files[MODULE] = patch(files[MODULE])
    files[f"{DIST}/WHEEL"] += f"Build: {BUILD}\n".encode()
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], timeout=10, text=True).strip()
    record = {
        "status": "REVIEW_CANDIDATE_NOT_APPROVED",
        "advisory": "GHSA-qr6x-7v33-6qmg",
        "scope": "SAM model-name allowlist before filename and URL construction",
        "upstream_version": VERSION,
        "upstream_wheel_url": SOURCE_URL,
        "upstream_wheel_sha256": WHEEL_SHA256,
        "upstream_sam_sha256": SAM_SHA256,
        "patched_sam_sha256": digest(files[MODULE]),
        "builder_sha256": digest(Path(__file__).read_bytes()),
        "source_commit": commit,
        "production_environment_modified": False,
        "version_bump_or_audit_exception_added": False,
        "limitations": ["Other rembg advisories remain open", "Download hash pinning is unchanged",
                        "Host/cache tampering is outside this patch", "Not a GPU or model-quality test"],
        "required_next": ["Independent security review", "Exact image integration and scan",
                          "Rights-cleared Standard direct/SDK GPU quality certification"],
    }
    files[f"{DIST}/DRAPIXAI_PATCH.json"] = (json.dumps(record, indent=2) + "\n").encode()
    record_name = f"{DIST}/RECORD"
    entries = io.StringIO(newline="")
    writer = csv.writer(entries, lineterminator="\n")
    for name, data in sorted(files.items()):
        if name != record_name:
            encoded = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            writer.writerow([name, "sha256=" + encoded, len(data)])
    writer.writerow([record_name, "", ""])
    files[record_name] = entries.getvalue().encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 11, 3, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    candidate = buffer.getvalue()
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"rembg-{VERSION}-{BUILD}-py3-none-any.whl"
    if target.exists() and target.read_bytes() != candidate:
        raise ValueError("REFUSING_TO_OVERWRITE_DIFFERENT_CANDIDATE")
    target.write_bytes(candidate)
    record["candidate_wheel_sha256"] = digest(candidate)
    (output / "build.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.wheel, args.output_dir), indent=2))
