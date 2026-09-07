#!/usr/bin/env python3
"""Reject unsafe staging templates; live infrastructure needs separate evidence."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from staging_topology import load_compose, validate


def parse_env(path: Path) -> dict[str, str]:
    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path.name}: expected KEY=value")
        key, value = line.split("=", 1)
        if key in values:
            raise ValueError(f"{path.name}: duplicate environment key")
        values[key] = value
    return values


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    report = {"passed": False, "controls": {}, "failures": []}
    try:
        report = validate(
            load_compose((root / "deploy/staging/docker-compose.edge.yml").read_text(encoding="utf-8")),
            load_compose((root / "deploy/staging/docker-compose.ai.yml").read_text(encoding="utf-8")),
            parse_env(root / "deploy/staging/.images.env.example"),
            parse_env(root / "deploy/env/api.staging.example"),
            parse_env(root / "deploy/release/standard-catvton-rc1.env"),
        )
        sources = report.pop("secret_sources")
        report["controls"]["secrets_are_mounted_and_git_ignored"] = False
        profile_attached = report["controls"]["standard_release_profile_is_loaded"]
        report["controls"]["standard_release_profile_is_loaded"] = False
        ignored = bool(sources)
        for source in sources:
            result = subprocess.run(
                ["git", "check-ignore", "--quiet", "--", f"deploy/staging/{source[2:]}"],
                cwd=root, capture_output=True, check=False, timeout=10,
            )
            ignored = ignored and result.returncode == 0
        report["controls"]["secrets_are_mounted_and_git_ignored"] = (
            ignored and report["controls"]["secret_mounts_are_read_only"]
        )
        if not ignored:
            report["failures"].append("Staging secret bind sources must be untracked and Git-ignored")
        result = subprocess.run(
            [sys.executable, str(root / "deploy/scripts/verify-standard-release-profile.py")],
            cwd=root, capture_output=True, text=True, check=False, timeout=30,
        )
        if result.returncode != 0:
            report["failures"].append("Standard CatVTON release profile verification failed")
        else:
            report["controls"]["standard_release_profile_is_loaded"] = profile_attached
    except Exception as error:
        # Do not emit source fragments: future inputs may contain credentials.
        report["failures"].append(f"Topology verification could not complete: {type(error).__name__}")
        report["controls"]["verification_completed"] = False
    report["scope"] = "repository-staging-templates-not-live-infrastructure"
    report["passed"] = not report["failures"]
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
