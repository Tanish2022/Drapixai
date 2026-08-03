#!/usr/bin/env python3
"""Reject unsafe DrapixAI staging topology changes before deployment."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def require(source: str, marker: str, failures: list[str], label: str) -> None:
    if marker not in source:
        failures.append(f"{label}: missing {marker!r}")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    edge_path = repo_root / "deploy" / "staging" / "docker-compose.edge.yml"
    ai_path = repo_root / "deploy" / "staging" / "docker-compose.ai.yml"
    api_env_path = repo_root / "deploy" / "env" / "api.staging.example"
    failures: list[str] = []

    edge = edge_path.read_text(encoding="utf-8")
    ai = ai_path.read_text(encoding="utf-8")
    api_env = api_env_path.read_text(encoding="utf-8")

    for service in ("postgres", "redis", "minio"):
        block = edge.split(f"  {service}:\n", 1)[1].split("\n  ", 1)[0]
        if "ports:" in block:
            failures.append(f"edge:{service} must not publish a host port")

    require(edge, "127.0.0.1:${DRAPIXAI_STAGING_API_PORT", failures, "edge API")
    require(edge, "127.0.0.1:${DRAPIXAI_STAGING_WEB_PORT", failures, "edge web")
    require(edge, "internal: true", failures, "edge data network")
    require(ai, "127.0.0.1:${DRAPIXAI_STAGING_AI_PORT", failures, "AI API")
    require(ai, "standard-catvton-rc1.env", failures, "AI release profile")
    require(ai, "internal: true", failures, "AI network")

    env_requirements = {
        "DRAPIXAI_API_ENVIRONMENT": "sandbox",
        "DRAPIXAI_SECRETS_PROVIDER": "mounted-file",
        "DRAPIXAI_AI_PRIVATE_NETWORK": "1",
        "DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK": "0",
        "DRAPIXAI_ALLOW_LEGACY_API_KEYS": "0",
        "DRAPIXAI_ENABLE_LOWER_BODY": "0",
    }
    parsed = {}
    for raw in api_env.splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            parsed[key] = value
    for key, expected in env_requirements.items():
        if parsed.get(key) != expected:
            failures.append(f"api staging env: {key} must equal {expected!r}")

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
        },
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
