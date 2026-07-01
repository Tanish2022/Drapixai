#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
from pathlib import Path


def parse_headers(path: Path) -> dict[str, str]:
    headers: dict[str, str] = {}
    for line in path.read_text(errors="ignore").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()
    return headers


def parse_float(value: str) -> float | None:
    match = re.search(r"[0-9]+(?:\.[0-9]+)?", value or "")
    return float(match.group(0)) if match else None


def parse_int(value: str) -> int | None:
    match = re.search(r"[0-9]+", value or "")
    return int(match.group(0)) if match else None


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: assert-smoke-headers.py <headers-file>", file=sys.stderr)
        return 2

    headers_path = Path(sys.argv[1])
    if not headers_path.exists() or headers_path.stat().st_size <= 0:
        print(f"Headers file is missing or empty: {headers_path}", file=sys.stderr)
        return 1

    headers = parse_headers(headers_path)
    header = lambda name: headers.get(name.lower(), "").strip()

    min_quality = float(os.getenv("DRAPIXAI_LAUNCH_MIN_QUALITY_SCORE", "0.90"))
    max_latency_ms = int(os.getenv("DRAPIXAI_LAUNCH_TARGET_LATENCY_MS", "12000"))

    quality = parse_float(header("x-drapixai-quality-score"))
    candidate_count = parse_int(header("x-drapixai-candidate-count"))
    latency_ms = parse_int(header("x-drapixai-latency-ms"))
    warnings = header("x-drapixai-warnings")
    quality_mode = header("x-drapixai-quality-mode")
    garment_source = header("x-drapixai-garment-source")
    cache_status = header("x-drapixai-garment-cache-status")

    failures: list[str] = []
    if quality is None:
        failures.append("missing x-drapixai-quality-score")
    elif quality < min_quality:
        failures.append(f"quality {quality:.3f} is below launch minimum {min_quality:.3f}")

    if candidate_count != 1:
        failures.append(f"candidate_count must be 1 for Standard launch path, got {candidate_count!r}")
    if quality_mode.lower() != "standard":
        failures.append(f"quality mode must be standard, got {quality_mode!r}")
    if garment_source != "original_verified_cache_gate":
        failures.append(f"garment source must be original_verified_cache_gate, got {garment_source!r}")
    if cache_status != "verified":
        failures.append(f"garment cache status must be verified, got {cache_status!r}")
    if warnings:
        failures.append(f"SDK warnings must be empty for launch proof, got {warnings!r}")
    if latency_ms is None:
        failures.append("missing x-drapixai-latency-ms")
    elif latency_ms > max_latency_ms:
        failures.append(f"latency {latency_ms}ms exceeds launch target {max_latency_ms}ms")

    if failures:
        print("SDK launch quality gates failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(
        "SDK launch gates passed: "
        f"quality={quality:.3f}, latency_ms={latency_ms}, "
        f"candidate_count={candidate_count}, cache_status={cache_status}, source={garment_source}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())