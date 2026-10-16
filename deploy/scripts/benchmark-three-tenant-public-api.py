#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure three or four simultaneous tenants through DrapixAI public API v1; visual and release approval are separate."
    )
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base-url", required=True, help="Example: https://api.staging.drapixai.com/v1")
    parser.add_argument("--output-dir", default="runtime/three-tenant-public-api")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--quality-threshold", type=float, default=0.95)
    parser.add_argument("--latency-target-ms", type=int, default=12000)
    parser.add_argument("--concurrent-tenants", type=int, choices=(3, 4), default=3)
    parser.add_argument("--required-worker-batch-size", type=int, default=None)
    parser.add_argument("--minimum-headroom-ratio", type=float, default=0.20)
    parser.add_argument(
        "--retain-output-images",
        action="store_true",
        help="Save generated test PNGs for consented internal visual review. Disabled by default.",
    )
    args = parser.parse_args()
    if args.required_worker_batch_size is None:
        args.required_worker_batch_size = args.concurrent_tenants
    if args.required_worker_batch_size != args.concurrent_tenants:
        parser.error("--required-worker-batch-size must equal --concurrent-tenants; queued or fallback execution cannot certify a full batch")
    if not math.isfinite(args.quality_threshold) or not 0.95 <= args.quality_threshold <= 1:
        parser.error("--quality-threshold must be finite and between 0.95 and 1")
    if not math.isfinite(args.minimum_headroom_ratio) or not 0.20 <= args.minimum_headroom_ratio < 1:
        parser.error("--minimum-headroom-ratio must be finite, at least 0.20 and below 1")
    if not 0 < args.latency_target_ms <= 12000:
        parser.error("--latency-target-ms must be positive and at most 12000")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    return args


def load_manifest(path: Path, concurrent_tenants: int = 3) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    if concurrent_tenants not in (3, 4) or not isinstance(cases, list) or len(cases) != concurrent_tenants:
        raise ValueError(f"Manifest must contain exactly {concurrent_tenants} tenant cases")
    token_envs: set[str] = set()
    token_values: set[str] = set()
    case_ids: set[str] = set()
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ValueError(f"Case {index + 1} must be an object")
        for required in ("id", "person", "product_id", "token_env"):
            if not case.get(required):
                raise ValueError(f"Case {index + 1} is missing {required}")
        case_id = str(case["id"])
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", case_id) or case_id in case_ids:
            raise ValueError("Every case needs a unique safe ID")
        case_ids.add(case_id)
        token_env = str(case["token_env"])
        if token_env in token_envs:
            raise ValueError("Every case must use a distinct tenant token environment variable")
        token_envs.add(token_env)
        token_value = os.getenv(token_env)
        if not token_value:
            raise ValueError(f"Required token environment variable is unset: {token_env}")
        if token_value in token_values:
            raise ValueError("Every case must use a distinct tenant credential, not aliases of one token")
        token_values.add(token_value)
    return cases


def reject_nonfinite_json(value: str) -> None:
    raise ValueError("Non-finite timing value")


def finite_json_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("Non-finite timing value")
    return parsed


def parse_timing_header(response: requests.Response) -> dict[str, Any]:
    value = response.headers.get("x-drapixai-timing-json", "")
    if not value:
        return {}
    try:
        payload = json.loads(value, parse_constant=reject_nonfinite_json, parse_float=finite_json_float)
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def percentile(values: list[int], value: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, math.ceil(value * len(ordered)) - 1)]


def _int_header(response: requests.Response, name: str) -> int:
    try:
        return int(response.headers.get(name) or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def _float_header(response: requests.Response, name: str) -> float:
    try:
        value = float(response.headers.get(name) or 0)
        return value if math.isfinite(value) else 0.0
    except (TypeError, ValueError, OverflowError):
        return 0.0


def failure_result(case: dict[str, Any], *, wall_ms: int, error: str, status: int = 0) -> dict[str, Any]:
    return {
        "id": str(case["id"]),
        "token_env": str(case["token_env"]),
        "product_id": str(case["product_id"]),
        "tryon_id": "",
        "status": status,
        "output": None,
        "quality_score": 0.0,
        "candidate_count": 0,
        "warnings": [],
        "wall_ms": wall_ms,
        "reported_latency_ms": 0,
        "media_retention": "",
        "training_use": "",
        "worker_batch_size": 0,
        "gpu_peak_allocated_mb": 0,
        "gpu_peak_reserved_mb": 0,
        "gpu_total_mb": 0,
        "gpu_headroom_ratio": 0.0,
        "timings": {},
        "error": error,
    }


def run_case(
    case: dict[str, Any],
    *,
    base_url: str,
    output_dir: Path,
    timeout: int,
    retain_output_images: bool,
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
    try:
        with person_path.open("rb") as person_file:
            response = requests.post(
                f"{base_url.rstrip('/')}/tryons",
                headers=headers,
                data=form,
                files={"person_image": (person_path.name, person_file, "image/jpeg")},
                timeout=timeout,
            )
    except requests.RequestException:
        return failure_result(
            case,
            wall_ms=int((time.perf_counter() - started) * 1000),
            error="TRYON_REQUEST_FAILED",
        )
    except OSError:
        return failure_result(
            case,
            wall_ms=int((time.perf_counter() - started) * 1000),
            error="PERSON_IMAGE_READ_FAILED",
        )

    wall_ms = int((time.perf_counter() - started) * 1000)
    if response.status_code < 200 or response.status_code >= 300:
        return failure_result(case, wall_ms=wall_ms, status=response.status_code, error=f"TRYON_HTTP_{response.status_code}")

    output_path = output_dir / f"{case_id}.png"
    if retain_output_images:
        output_path.write_bytes(response.content)
    warnings = [item for item in response.headers.get("x-drapixai-warnings", "").split(",") if item]
    timing = parse_timing_header(response)
    return {
        "id": case_id,
        "token_env": str(case["token_env"]),
        "product_id": str(case["product_id"]),
        "tryon_id": response.headers.get("x-drapixai-tryon-result-id", ""),
        "status": response.status_code,
        "output": str(output_path) if retain_output_images else None,
        "quality_score": _float_header(response, "x-drapixai-quality-score"),
        "candidate_count": _int_header(response, "x-drapixai-candidate-count"),
        "warnings": warnings,
        "wall_ms": wall_ms,
        "reported_latency_ms": _int_header(response, "x-drapixai-latency-ms"),
        "media_retention": response.headers.get("x-drapixai-media-retention", ""),
        "training_use": response.headers.get("x-drapixai-training-use", ""),
        "worker_batch_size": _int_header_from_timing(timing, "worker_batch_size"),
        "gpu_peak_allocated_mb": _int_header_from_timing(timing, "gpu_peak_allocated_mb"),
        "gpu_peak_reserved_mb": _int_header_from_timing(timing, "gpu_peak_reserved_mb"),
        "gpu_total_mb": _int_header_from_timing(timing, "gpu_total_mb"),
        "gpu_headroom_ratio": _float_header_from_timing(timing, "gpu_headroom_ratio"),
        "timings": timing,
        "error": None,
    }


def _int_header_from_timing(timing: dict[str, Any], name: str) -> int:
    try:
        value = timing.get(name)
        if isinstance(value, bool) or isinstance(value, float) and not value.is_integer():
            return 0
        return int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def _float_header_from_timing(timing: dict[str, Any], name: str) -> float:
    try:
        if isinstance(timing.get(name), bool):
            return 0.0
        value = float(timing.get(name) or 0)
        return value if math.isfinite(value) else 0.0
    except (TypeError, ValueError, OverflowError):
        return 0.0

def verify_tenant_boundaries(cases: list[dict[str, Any]], results: list[dict[str, Any]], base_url: str, timeout: int, probe_counts: dict[str, int] | None = None) -> list[str]:
    failures: list[str] = []
    counts = probe_counts if probe_counts is not None else {}
    counts.update(owner_attempts=0, cross_attempts=0, cross_denials=0)
    by_id = {str(case["id"]): case for case in cases}
    for result in results:
        if not result["tryon_id"]:
            failures.append(f"{result['id']}: metadata boundary checks skipped because try-on did not complete")
            continue
        owner_case = by_id[result["id"]]
        owner_token = os.environ[str(owner_case["token_env"])]
        try:
            counts["owner_attempts"] += 1
            own_response = requests.get(
                f"{base_url.rstrip('/')}/tryons/{result['tryon_id']}",
                headers={"Authorization": f"Bearer {owner_token}"},
                timeout=timeout,
            )
        except requests.RequestException:
            failures.append(f"{result['id']}: owner metadata lookup failed")
            continue
        if own_response.status_code != 200:
            failures.append(f"{result['id']}: owner metadata lookup returned {own_response.status_code}")
        else:
            try:
                metadata = own_response.json()
            except ValueError:
                failures.append(f"{result['id']}: owner metadata lookup was not valid JSON")
            else:
                if not isinstance(metadata, dict) or str(metadata.get("product_id")) != result["product_id"]:
                    failures.append(f"{result['id']}: result/product association changed")

        for other_case in cases:
            if other_case["id"] == result["id"]:
                continue
            other_token = os.environ[str(other_case["token_env"])]
            try:
                counts["cross_attempts"] += 1
                cross_response = requests.get(
                    f"{base_url.rstrip('/')}/tryons/{result['tryon_id']}",
                    headers={"Authorization": f"Bearer {other_token}"},
                    timeout=timeout,
                )
            except requests.RequestException:
                failures.append(f"{other_case['id']}: cross-tenant metadata probe failed")
                continue
            if cross_response.status_code != 404:
                failures.append(
                    f"{other_case['id']} could probe {result['id']} result: {cross_response.status_code}"
                )
            else:
                counts["cross_denials"] += 1
    return failures

def result_failures(result: dict[str, Any], args: argparse.Namespace) -> list[str]:
    failures: list[str] = []
    if result.get("error"):
        failures.append(f"{result['id']}: {result['error']}")
    if result["candidate_count"] != 1:
        failures.append(f"{result['id']}: candidate_count is not 1")
    if not math.isfinite(result["quality_score"]) or not args.quality_threshold <= result["quality_score"] <= 1:
        failures.append(f"{result['id']}: quality score is invalid or below threshold")
    if result["warnings"]:
        failures.append(f"{result['id']}: warnings present")
    if result["media_retention"] != "transient-only":
        failures.append(f"{result['id']}: media retention contract missing")
    if result["training_use"] != "none":
        failures.append(f"{result['id']}: no-training contract missing")
    if result["worker_batch_size"] != args.required_worker_batch_size:
        failures.append(f"{result['id']}: worker batch was {result['worker_batch_size']}, expected {args.required_worker_batch_size}")
    if not math.isfinite(result["gpu_headroom_ratio"]) or not args.minimum_headroom_ratio <= result["gpu_headroom_ratio"] < 1:
        failures.append(f"{result['id']}: GPU headroom is invalid or below threshold")
    total = result["gpu_total_mb"]
    reserved = result["gpu_peak_reserved_mb"]
    allocated = result["gpu_peak_allocated_mb"]
    if not 0 < allocated <= reserved <= total or total <= 0:
        failures.append(f"{result['id']}: GPU memory measurements are missing or inconsistent")
    else:
        measured_headroom = (total - reserved) / total
        if measured_headroom < args.minimum_headroom_ratio or abs(measured_headroom - result["gpu_headroom_ratio"]) > 0.0001:
            failures.append(f"{result['id']}: reserved VRAM does not support reported headroom")
    if result["wall_ms"] <= 0 or result["wall_ms"] > args.latency_target_ms:
        failures.append(f"{result['id']}: wall latency is invalid or above target")
    return failures


def main() -> int:
    args = parse_args()
    cases = load_manifest(Path(args.manifest).expanduser().resolve(), args.concurrent_tenants)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    wall_started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=args.concurrent_tenants) as executor:
        futures = [
            executor.submit(
                run_case,
                case,
                base_url=args.base_url,
                output_dir=output_dir,
                timeout=args.timeout,
                retain_output_images=args.retain_output_images,
            )
            for case in cases
        ]
        future_cases = {future: case for future, case in zip(futures, cases)}
        for future in as_completed(futures):
            case = future_cases[future]
            try:
                results.append(future.result())
            except Exception:
                results.append(failure_result(case, wall_ms=0, error="BENCHMARK_WORKER_FAILED"))
    wall_total_ms = int((time.perf_counter() - wall_started) * 1000)
    results.sort(key=lambda item: item["id"])

    probe_counts: dict[str, int] = {}
    failures = verify_tenant_boundaries(cases, results, args.base_url, args.timeout, probe_counts)
    required_cross_probes = args.concurrent_tenants * (args.concurrent_tenants - 1)
    if probe_counts.get("cross_denials", 0) != required_cross_probes:
        failures.append("Not all required cross-tenant denial probes passed")
    result_ids = [item["tryon_id"] for item in results]
    if any(not item for item in result_ids) or len(set(result_ids)) != args.concurrent_tenants:
        failures.append(f"{args.concurrent_tenants} unique try-on result IDs were not returned")
    for result in results:
        failures.extend(result_failures(result, args))

    p95_wall_ms = percentile([result["wall_ms"] for result in results], 0.95)
    if p95_wall_ms > args.latency_target_ms:
        failures.append(f"p95 wall latency {p95_wall_ms}ms exceeds {args.latency_target_ms}ms")

    report = {
        "status": "PASS" if not failures else "FAIL",
        "base_url": args.base_url,
        "target_concurrent_tenants": args.concurrent_tenants,
        "wall_total_ms": wall_total_ms,
        "p95_wall_ms": p95_wall_ms,
        "quality_threshold": args.quality_threshold,
        "latency_target_ms": args.latency_target_ms,
        "required_worker_batch_size": args.required_worker_batch_size,
        "minimum_headroom_ratio": args.minimum_headroom_ratio,
        "output_images_retained": args.retain_output_images,
        "cross_tenant_probes": probe_counts.get("cross_attempts", 0),
        "cross_tenant_denials": probe_counts.get("cross_denials", 0),
        "required_cross_tenant_probes": required_cross_probes,
        "scope": "technical-concurrency-measurement-not-visual-or-release-approval",
        "accepted_requests": sum(not result_failures(result, args) for result in results),
        "failed_or_rejected_requests": sum(bool(result_failures(result, args)) for result in results),
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
