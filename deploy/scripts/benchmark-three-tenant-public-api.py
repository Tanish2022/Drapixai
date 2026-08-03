#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Certify three simultaneous tenants through DrapixAI public API v1."
    )
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base-url", required=True, help="Example: https://api.staging.drapixai.com/v1")
    parser.add_argument("--output-dir", default="runtime/three-tenant-public-api")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--quality-threshold", type=float, default=0.95)
    parser.add_argument("--latency-target-ms", type=int, default=12000)
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    if not isinstance(cases, list) or len(cases) != 3:
        raise ValueError("Manifest must contain exactly three tenant cases")
    token_envs: set[str] = set()
    for index, case in enumerate(cases):
        for required in ("id", "person", "product_id", "token_env"):
            if not case.get(required):
                raise ValueError(f"Case {index + 1} is missing {required}")
        token_env = str(case["token_env"])
        if token_env in token_envs:
            raise ValueError("Every case must use a distinct tenant token environment variable")
        token_envs.add(token_env)
        if not os.getenv(token_env):
            raise ValueError(f"Required token environment variable is unset: {token_env}")
    return cases


def percentile(values: list[int], value: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(value * len(ordered)) - 1)]


def run_case(
    case: dict[str, Any],
    *,
    base_url: str,
    output_dir: Path,
    timeout: int,
) -> dict[str, Any]:
    case_id = str(case["id"])
    token = os.environ[str(case["token_env"])]
    person_path = Path(str(case["person"])).expanduser().resolve()
    idempotency_key = f"drapixai-{case_id}-{uuid.uuid4()}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idempotency_key,
        "X-Request-Id": f"three-tenant-{case_id}-{uuid.uuid4()}",
    }
    form = {
        "productId": str(case["product_id"]),
        "garment_type": "upper",
        "quality": "standard",
        "shopper_consent": "true",
        "privacy_policy_version": "2026-08-04",
    }
    started = time.perf_counter()
    with person_path.open("rb") as person_file:
        response = requests.post(
            f"{base_url.rstrip('/')}/tryons",
            headers=headers,
            data=form,
            files={"person_image": (person_path.name, person_file, "image/jpeg")},
            timeout=timeout,
        )
    wall_ms = int((time.perf_counter() - started) * 1000)
    response.raise_for_status()
    output_path = output_dir / f"{case_id}.png"
    output_path.write_bytes(response.content)
    warnings = [item for item in response.headers.get("x-drapixai-warnings", "").split(",") if item]
    return {
        "id": case_id,
        "token_env": str(case["token_env"]),
        "product_id": str(case["product_id"]),
        "tryon_id": response.headers.get("x-drapixai-tryon-result-id", ""),
        "status": response.status_code,
        "output": str(output_path),
        "quality_score": float(response.headers.get("x-drapixai-quality-score") or 0),
        "candidate_count": int(response.headers.get("x-drapixai-candidate-count") or 0),
        "warnings": warnings,
        "wall_ms": wall_ms,
        "reported_latency_ms": int(response.headers.get("x-drapixai-latency-ms") or 0),
        "media_retention": response.headers.get("x-drapixai-media-retention", ""),
        "training_use": response.headers.get("x-drapixai-training-use", ""),
    }


def verify_tenant_boundaries(cases: list[dict[str, Any]], results: list[dict[str, Any]], base_url: str, timeout: int) -> list[str]:
    failures: list[str] = []
    by_id = {str(case["id"]): case for case in cases}
    for result in results:
        owner_case = by_id[result["id"]]
        owner_token = os.environ[str(owner_case["token_env"])]
        own_response = requests.get(
            f"{base_url.rstrip('/')}/tryons/{result['tryon_id']}",
            headers={"Authorization": f"Bearer {owner_token}"},
            timeout=timeout,
        )
        if own_response.status_code != 200:
            failures.append(f"{result['id']}: owner metadata lookup returned {own_response.status_code}")
        else:
            metadata = own_response.json()
            if str(metadata.get("product_id")) != result["product_id"]:
                failures.append(f"{result['id']}: result/product association changed")

        for other_case in cases:
            if other_case["id"] == result["id"]:
                continue
            other_token = os.environ[str(other_case["token_env"])]
            cross_response = requests.get(
                f"{base_url.rstrip('/')}/tryons/{result['tryon_id']}",
                headers={"Authorization": f"Bearer {other_token}"},
                timeout=timeout,
            )
            if cross_response.status_code != 404:
                failures.append(
                    f"{other_case['id']} could probe {result['id']} result: {cross_response.status_code}"
                )
    return failures


def main() -> int:
    args = parse_args()
    cases = load_manifest(Path(args.manifest).expanduser().resolve())
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    wall_started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(
                run_case,
                case,
                base_url=args.base_url,
                output_dir=output_dir,
                timeout=args.timeout,
            )
            for case in cases
        ]
        for future in as_completed(futures):
            results.append(future.result())
    wall_total_ms = int((time.perf_counter() - wall_started) * 1000)
    results.sort(key=lambda item: item["id"])

    failures = verify_tenant_boundaries(cases, results, args.base_url, args.timeout)
    result_ids = [item["tryon_id"] for item in results]
    if any(not item for item in result_ids) or len(set(result_ids)) != 3:
        failures.append("Three unique try-on result IDs were not returned")
    for result in results:
        if result["candidate_count"] != 1:
            failures.append(f"{result['id']}: candidate_count is not 1")
        if result["quality_score"] < args.quality_threshold:
            failures.append(f"{result['id']}: quality score is below threshold")
        if result["warnings"]:
            failures.append(f"{result['id']}: warnings={result['warnings']}")
        if result["media_retention"] != "transient-only":
            failures.append(f"{result['id']}: media retention contract missing")
        if result["training_use"] != "none":
            failures.append(f"{result['id']}: no-training contract missing")

    p95_wall_ms = percentile([result["wall_ms"] for result in results], 0.95)
    if p95_wall_ms > args.latency_target_ms:
        failures.append(f"p95 wall latency {p95_wall_ms}ms exceeds {args.latency_target_ms}ms")

    report = {
        "status": "PASS" if not failures else "FAIL",
        "base_url": args.base_url,
        "target_concurrent_tenants": 3,
        "wall_total_ms": wall_total_ms,
        "p95_wall_ms": p95_wall_ms,
        "quality_threshold": args.quality_threshold,
        "latency_target_ms": args.latency_target_ms,
        "cross_tenant_probes": 6,
        "results": results,
        "failures": failures,
    }
    report_path = output_dir / "summary.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"Report: {report_path}")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
