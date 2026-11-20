#!/usr/bin/env python3
"""Render stricter dependency assertions for the isolated RTX review image.

The serving Dockerfile remains unchanged. The candidate installs the two reviewed backports into the builder virtual environment
and checks the patched package metadata before copying it to the runtime stage. This does not approve the candidate for serving traffic.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

VERSIONS = {"pillow": ("12.3.0", "13.0.0"),
            "msgpack": ("1.2.1", "1.2.3"),
            "urllib3": ("2.7.0", "2.8.0")}


# The named BuildKit context contains only the two outputs of prepare_rtx_wheels.
WHEEL_INSTALL = """RUN --mount=type=bind,from=reviewed-wheels,target=/wheels,ro \\
    python -m pip install --no-index --no-deps --force-reinstall /wheels/*.whl \\
    && python -m pip check \\
    && python -c "from importlib.metadata import distribution; assert all(distribution(n).read_text('DRAPIXAI_PATCH.json') for n in ('accelerate','rembg'))"

"""


def render(source: bytes, requirements: str) -> bytes:
    text = source.decode("utf-8")
    pins = {}
    for line in requirements.splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "==" in line:
            name, version = line.split("==", 1)
            if name in pins:
                raise ValueError("DUPLICATE_CANDIDATE_PIN")
            pins[name] = version
    for name, (old, new) in VERSIONS.items():
        if pins.get(name) != new:
            raise ValueError(f"CANDIDATE_PIN_MISMATCH:{name}")
        before = f"    '{name}': '{old}',"
        if text.count(before) != 1:
            raise ValueError(f"SERVING_ASSERTION_CHANGED:{name}")
        text = text.replace(before, f"    '{name}': '{new}',")
    for name, version in {"accelerate": "1.11.0", "rembg": "2.0.69"}.items():
        if pins.get(name) != version:
            raise ValueError(f"BACKPORT_PIN_MISMATCH:{name}")
    boundary = "FROM ${DRAPIXAI_AI_BASE_IMAGE} AS runtime"
    if text.count(boundary) != 1:
        raise ValueError("RUNTIME_BOUNDARY_CHANGED")
    text = text.replace(boundary, WHEEL_INSTALL + boundary)
    return text.encode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    allowed = (repo / "runtime/security-candidate").resolve()
    output = args.output_dir.resolve()
    if output == allowed or not output.is_relative_to(allowed):
        parser.error("Output must be a subdirectory of runtime/security-candidate")
    original = repo / "drapixai_ai/docker/Dockerfile"
    requirements = repo / "drapixai_ai/requirements.rtx-pro-6000.security-candidate.txt"
    source = original.read_bytes()
    pins = requirements.read_bytes()
    generated = render(source, pins.decode("utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    (output / "Dockerfile").write_bytes(generated)
    record = {
        "status": "ISOLATED_REVIEW_CANDIDATE_NOT_PROMOTED",
        "serving_dockerfile_sha256": hashlib.sha256(source).hexdigest(),
        "candidate_requirements_sha256": hashlib.sha256(pins).hexdigest(),
        "rendered_dockerfile_sha256": hashlib.sha256(generated).hexdigest(),
        "assertion_versions": {name: new for name, (_, new) in VERSIONS.items()},
        "production_files_modified": False,
    }
    (output / "dockerfile.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
