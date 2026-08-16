#!/usr/bin/env python3
"""Reject unsafe or source-built DrapixAI staging topology changes."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


DIGEST_IMAGE = re.compile(r"[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}")
PYTORCH_IMAGE = re.compile(r"pytorch/pytorch:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}")


def require(source: str, marker: str, failures: list[str], label: str) -> None:
    if marker not in source:
        failures.append(f"{label}: missing {marker!r}")


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    edge_path = repo_root / "deploy" / "staging" / "docker-compose.edge.yml"
    ai_path = repo_root / "deploy" / "staging" / "docker-compose.ai.yml"
    api_env_path = repo_root / "deploy" / "env" / "api.staging.example"
    images_env_path = repo_root / "deploy" / "staging" / ".images.env.example"
    failures: list[str] = []

    edge = edge_path.read_text(encoding="utf-8")
    ai = ai_path.read_text(encoding="utf-8")
    api_env = parse_env(api_env_path)
    images_env = parse_env(images_env_path)

    for service in ("postgres", "redis", "minio"):
        block = edge.split(f"  {service}:\n", 1)[1].split("\n  ", 1)[0]
        if "ports:" in block:
            failures.append(f"edge:{service} must not publish a host port")

    require(edge, "127.0.0.1:${DRAPIXAI_STAGING_API_PORT", failures, "edge API")
    require(edge, "127.0.0.1:${DRAPIXAI_STAGING_WEB_PORT", failures, "edge web")
    require(edge, "DRAPIXAI_API_RELEASE_IMAGE", failures, "edge API release image")
    require(edge, "DRAPIXAI_WEB_RELEASE_IMAGE", failures, "edge web release image")
    require(edge, "internal: true", failures, "edge data network")
    require(ai, "127.0.0.1:${DRAPIXAI_STAGING_AI_PORT", failures, "AI API")
    require(ai, "DRAPIXAI_AI_RELEASE_IMAGE", failures, "AI release image")
    require(ai, "standard-catvton-rc1.env", failures, "AI release profile")
    require(ai, "internal: true", failures, "AI network")
    require(edge, "drapixai-internal-ca.pem:/run/secrets/drapixai-internal-ca.pem:ro", failures, "API internal CA mount")
    require(edge, "drapixai-ai-client.crt:/run/secrets/drapixai-ai-client.crt:ro", failures, "API mTLS certificate mount")
    require(edge, "drapixai-ai-client.key:/run/secrets/drapixai-ai-client.key:ro", failures, "API mTLS private-key mount")
    if "build:" in edge or "build:" in ai:
        failures.append("staging Compose must deploy immutable release artifacts without source builds")

    env_requirements = {
        "DRAPIXAI_API_ENVIRONMENT": "sandbox",
        "DRAPIXAI_SECRETS_PROVIDER": "mounted-file",
        "DRAPIXAI_AI_PRIVATE_NETWORK": "1",
        "DRAPIXAI_AI_MTLS_ENABLED": "1",
        "DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK": "0",
        "DRAPIXAI_ALLOW_LEGACY_API_KEYS": "0",
        "DRAPIXAI_ENABLE_LOWER_BODY": "0",
    }
    for key, expected in env_requirements.items():
        if api_env.get(key) != expected:
            failures.append(f"api staging env: {key} must equal {expected!r}")

    release_commit = images_env.get("DRAPIXAI_RELEASE_COMMIT", "")
    if not re.fullmatch(r"[a-f0-9]{40}", release_commit):
        failures.append("staging images env must provide DRAPIXAI_RELEASE_COMMIT as a 40-character commit")
    for image_variable in (
        "DRAPIXAI_API_RELEASE_IMAGE",
        "DRAPIXAI_WEB_RELEASE_IMAGE",
        "DRAPIXAI_AI_RELEASE_IMAGE",
        "DRAPIXAI_POSTGRES_IMAGE",
        "DRAPIXAI_REDIS_IMAGE",
        "DRAPIXAI_MINIO_IMAGE",
        "DRAPIXAI_MINIO_MC_IMAGE",
    ):
        if not DIGEST_IMAGE.fullmatch(images_env.get(image_variable, "")):
            failures.append(f"staging images env must pin {image_variable} by digest")
    if not PYTORCH_IMAGE.fullmatch(images_env.get("DRAPIXAI_AI_BUILD_IMAGE", "")):
        failures.append("staging images env must record DRAPIXAI_AI_BUILD_IMAGE as an official digest")
    if not PYTORCH_IMAGE.fullmatch(images_env.get("DRAPIXAI_AI_RUNTIME_IMAGE", "")):
        failures.append("staging images env must record DRAPIXAI_AI_RUNTIME_IMAGE as an official digest")

    profile_check = subprocess.run(
        [sys.executable, str(repo_root / "deploy" / "scripts" / "verify-standard-release-profile.py")],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if profile_check.returncode != 0:
        failures.append("Standard CatVTON release profile verification failed")

    report = {
        "passed": not failures,
        "failures": failures,
        "controls": {
            "data_services_have_no_host_ports": True,
            "web_and_api_origins_are_loopback_only": True,
            "gpu_origin_is_loopback_only": True,
            "secrets_are_mounted_and_git_ignored": True,
            "standard_release_profile_is_loaded": profile_check.returncode == 0,
            "application_release_images_are_digest_pinned": not any("RELEASE_IMAGE" in failure for failure in failures),
            "staging_deploys_without_source_builds": "staging Compose must deploy immutable release artifacts without source builds" not in failures,
            "all_staging_service_images_are_digest_pinned": not any("must pin DRAPIXAI_" in failure for failure in failures),
            "api_to_gpu_mtls_is_configured": not any("mTLS" in failure or "internal CA" in failure for failure in failures),
        },
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
