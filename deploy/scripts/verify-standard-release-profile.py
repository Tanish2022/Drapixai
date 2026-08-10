#!/usr/bin/env python3
"""Verify the immutable upper-body Standard CatVTON release profile."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


EXPECTED = {
    "DRAPIXAI_RELEASE_PROFILE": "standard-catvton-rc1",
    "DRAPIXAI_QUALITY_MODE": "standard",
    "DRAPIXAI_TRYON_ENGINE": "catvton",
    "DRAPIXAI_WORKER_ROLE": "upper",
    "DRAPIXAI_ENABLE_LOWER_BODY": "0",
    "DRAPIXAI_CATVTON_GIT_COMMIT": "7818397f25613beedb3d861a34769f607cfcf3b1",
    "DRAPIXAI_CATVTON_MODEL_REVISION": "2969fcf85fe62f2036605716f0b56f0b81d01d79",
    "DRAPIXAI_CATVTON_BASE_REVISION": "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb",
    "DRAPIXAI_CATVTON_VAE_REVISION": "31f26fdeee1355a5c34592e401dd41e45d25a493",
    "DRAPIXAI_CANDIDATE_COUNT": "1",
    "DRAPIXAI_INFERENCE_STEPS": "22",
    "DRAPIXAI_GUIDANCE_SCALE": "2.5",
    "DRAPIXAI_CATVTON_WIDTH": "768",
    "DRAPIXAI_CATVTON_HEIGHT": "1024",
    "DRAPIXAI_CATVTON_MASK_SOURCE": "automasker",
    "DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK": "0",
    "DRAPIXAI_MIN_QUALITY_SCORE": "0.95",
    "DRAPIXAI_GARMENT_CACHE_VERSION": "v3-1024x1365",
    "DRAPIXAI_ENABLE_FINAL_OUTPUT_UPSCALE": "1",
    "DRAPIXAI_OUTPUT_WIDTH": "1024",
    "DRAPIXAI_OUTPUT_HEIGHT": "1365",
    "DRAPIXAI_OUTPUT_FORMAT": "png",
    "DRAPIXAI_ADAPTIVE_BATCHING": "0",
    "DRAPIXAI_TARGET_TRYON_MS": "12000",
}


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in values:
            raise ValueError(f"{path}:{line_number}: invalid or duplicate key {key!r}")
        values[key] = value.strip()
    return values


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile",
        type=Path,
        default=repo_root / "deploy" / "release" / "standard-catvton-rc1.env",
    )
    args = parser.parse_args()

    profile = args.profile.resolve()
    values = parse_env(profile)
    mismatches = {
        key: {"expected": expected, "actual": values.get(key)}
        for key, expected in EXPECTED.items()
        if values.get(key) != expected
    }

    source_checks = {
        "api_standard_only": (
            repo_root / "drapixai_ai" / "api" / "ai_server.py",
            'if requested != "standard":',
        ),
        "pipeline_standard_only": (
            repo_root / "drapixai_ai" / "pipeline" / "tryon_pipeline.py",
            'return "standard"',
        ),
        "sdk_standard_only": (
            repo_root / "apps" / "api" / "src" / "routes" / "sdk.ts",
            "requested === 'standard'",
        ),
    }
    missing_guards = [
        name
        for name, (path, marker) in source_checks.items()
        if not path.exists() or marker not in path.read_text(encoding="utf-8")
    ]

    production_compose = (repo_root / "deploy" / "docker-compose.ai.yml").read_text(encoding="utf-8")
    if any(marker in production_compose for marker in ("ai-lower-worker:", "Dockerfile.lower-body", "build:")):
        missing_guards.append("production_compose_standard_only")

    profile_precedence_checks = {
        "production_release_profile_precedence": (
            repo_root / "deploy" / "docker-compose.ai.yml",
            "./env/ai.production.env",
            "./release/standard-catvton-rc1.env",
        ),
        "staging_release_profile_precedence": (
            repo_root / "deploy" / "staging" / "docker-compose.ai.yml",
            "../env/ai.staging.env",
            "../release/standard-catvton-rc1.env",
        ),
    }
    profile_precedence_failures = []
    for name, (path, environment_file, release_profile) in profile_precedence_checks.items():
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        if text.find(environment_file) < 0 or text.find(release_profile) <= text.find(environment_file):
            profile_precedence_failures.append(name)

    report = {
        "profile": str(profile),
        "expected_values": len(EXPECTED),
        "mismatches": mismatches,
        "missing_source_guards": missing_guards,
        "profile_precedence_failures": profile_precedence_failures,
        "passed": not mismatches and not missing_guards and not profile_precedence_failures,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
