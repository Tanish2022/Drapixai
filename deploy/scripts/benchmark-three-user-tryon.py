#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the real DrapixAI API path with three simultaneous Standard requests."
    )
    parser.add_argument("--manifest", required=True, help="JSON manifest containing exactly three cases.")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000/ai/tryon")
    parser.add_argument("--service-token", default="")
    parser.add_argument("--output-dir", default="runtime/three-user-benchmark")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--quality-threshold", type=float, default=0.95)
    parser.add_argument("--latency-target-ms", type=int, default=12000)
    parser.add_argument("--minimum-headroom-ratio", type=float, default=0.20)
    args = parser.parse_args()
    if not math.isfinite(args.quality_threshold) or not 0.95 <= args.quality_threshold <= 1:
        parser.error("--quality-threshold must be finite and between 0.95 and 1")
    if not math.isfinite(args.minimum_headroom_ratio) or not 0.20 <= args.minimum_headroom_ratio < 1:
        parser.error("--minimum-headroom-ratio must be finite, at least 0.20 and below 1")
    if not 0 < args.latency_target_ms <= 12000:
        parser.error("--latency-target-ms must be positive and at most 12000")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    return args


def load_manifest(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    if not isinstance(cases, list) or len(cases) != 3:
        raise ValueError("Manifest must contain exactly three cases")
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ValueError(f"Case {index + 1} must be an object")
        if not case.get("person"):
            raise ValueError(f"Case {index + 1} is missing person")
        if not case.get("cloth") and not case.get("cloth_cache_key"):
            raise ValueError(f"Case {index + 1} needs cloth or cloth_cache_key")
    return cases


def percentile(values: list[int], percentile_value: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil(percentile_value * len(ordered)) - 1)
    return ordered[index]


def parse_json_header(response: requests.Response, name: str) -> dict[str, Any]:
    value = response.headers.get(name, "")
    if not value:
        return {}
    try:
        parsed = json.loads(value, parse_constant=reject_nonfinite_json, parse_float=finite_json_float)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def reject_nonfinite_json(value: str) -> None:
    raise ValueError("Non-finite timing value")


def finite_json_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("Non-finite timing value")
    return parsed


def finite_float(value: Any) -> float:
    try:
        result = float(value or 0)
        return result if math.isfinite(result) else 0.0
    except (TypeError, ValueError, OverflowError):
        return 0.0


def finite_int(value: Any) -> int:
    try:
        if isinstance(value, bool) or isinstance(value, float) and not value.is_integer():
            return 0
        return int(value or 0)
    except (TypeError, ValueError, OverflowError):
        return 0


def run_case(
    index: int,
    case: dict[str, Any],
    *,
    endpoint: str,
    service_token: str,
    output_dir: Path,
    timeout: int,
) -> dict[str, Any]:
    person_path = Path(case["person"]).expanduser().resolve()
    cloth_path = (
        Path(case["cloth"]).expanduser().resolve() if case.get("cloth") else None
    )
    data = {
        "user_id": str(case.get("user_id") or f"benchmark-user-{index + 1}"),
        "quality": "standard",
        "garment_type": str(case.get("garment_type") or "upper"),
    }
    if case.get("cloth_cache_key"):
        data["cloth_cache_key"] = str(case["cloth_cache_key"])

    headers = {}
    if service_token:
        headers["x-drapixai-service-token"] = service_token

    started = time.perf_counter()
    with person_path.open("rb") as person_file:
        files: dict[str, Any] = {
            "person_image": (person_path.name, person_file, "image/jpeg"),
        }
        if cloth_path is not None:
            with cloth_path.open("rb") as cloth_file:
                files["cloth_image"] = (cloth_path.name, cloth_file, "image/jpeg")
                response = requests.post(
                    endpoint,
                    data=data,
                    files=files,
                    headers=headers,
                    timeout=timeout,
                )
        else:
            response = requests.post(
                endpoint,
                data=data,
                files=files,
                headers=headers,
                timeout=timeout,
            )
    wall_ms = int((time.perf_counter() - started) * 1000)
    response.raise_for_status()

    case_id = str(case.get("id") or f"case-{index + 1}")
    output_path = output_dir / f"{case_id}.png"
    output_path.write_bytes(response.content)
    timing = parse_json_header(response, "x-drapixai-timing-json")
    warnings = [
        item
        for item in response.headers.get("x-drapixai-warnings", "").split(",")
        if item
    ]
    return {
        "id": case_id,
        "output": str(output_path),
        "status": response.status_code,
        "quality_score": finite_float(response.headers.get("x-drapixai-quality-score")),
        "candidate_count": finite_int(response.headers.get("x-drapixai-candidate-count")),
        "warnings": warnings,
        "processing_ms": finite_int(response.headers.get("x-drapixai-processing-ms")),
        "wall_ms": wall_ms,
        "worker_batch_size": finite_int(timing.get("worker_batch_size")),
        "gpu_peak_allocated_mb": finite_int(timing.get("gpu_peak_allocated_mb")),
        "gpu_peak_reserved_mb": finite_int(timing.get("gpu_peak_reserved_mb")),
        "gpu_total_mb": finite_int(timing.get("gpu_total_mb")),
        "gpu_headroom_ratio": finite_float(timing.get("gpu_headroom_ratio")),
        "timings": timing,
    }


def result_failures(result: dict[str, Any], args: argparse.Namespace) -> list[str]:
    failures: list[str] = []
    if result.get("error"):
        failures.append(f"{result['id']}: {result['error']}")
    if result["candidate_count"] != 1:
        failures.append(f"{result['id']}: candidate_count is not 1")
    if result["worker_batch_size"] != 3:
        failures.append(f"{result['id']}: worker batch was {result['worker_batch_size']}, expected 3")
    if not math.isfinite(result["quality_score"]) or not args.quality_threshold <= result["quality_score"] <= 1:
        failures.append(f"{result['id']}: quality score is invalid or below threshold")
    if result["warnings"]:
        failures.append(f"{result['id']}: warnings present")
    if not math.isfinite(result["gpu_headroom_ratio"]) or not args.minimum_headroom_ratio <= result["gpu_headroom_ratio"] < 1:
        failures.append(f"{result['id']}: GPU headroom is invalid or below threshold")
    total, reserved, allocated = result["gpu_total_mb"], result["gpu_peak_reserved_mb"], result["gpu_peak_allocated_mb"]
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
    manifest_path = Path(args.manifest).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    cases = load_manifest(manifest_path)

    results: list[dict[str, Any]] = []
    wall_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            executor.submit(
                run_case,
                index,
                case,
                endpoint=args.endpoint,
                service_token=args.service_token,
                output_dir=output_dir,
                timeout=args.timeout,
            ): index
            for index, case in enumerate(cases)
        }
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception:
                index = futures[future]
                results.append({
                    "id": str(cases[index].get("id") or f"case-{index + 1}"),
                    "output": None, "status": 0, "quality_score": 0.0,
                    "candidate_count": 0, "warnings": [], "processing_ms": 0,
                    "wall_ms": 0, "worker_batch_size": 0,
                    "gpu_peak_allocated_mb": 0, "gpu_peak_reserved_mb": 0,
                    "gpu_total_mb": 0, "gpu_headroom_ratio": 0.0,
                    "timings": {}, "error": "BENCHMARK_WORKER_FAILED",
                })
    wall_total_ms = int((time.perf_counter() - wall_start) * 1000)
    results.sort(key=lambda item: item["id"])

    failures: list[str] = []
    for result in results:
        failures.extend(result_failures(result, args))

    wall_values = [result["wall_ms"] for result in results]
    p95_wall_ms = percentile(wall_values, 0.95)
    if p95_wall_ms > args.latency_target_ms:
        failures.append(
            f"p95 wall latency {p95_wall_ms}ms exceeds {args.latency_target_ms}ms"
        )

    report = {
        "status": "PASS" if not failures else "FAIL",
        "target_batch_size": 3,
        "standard_candidate_count": 1,
        "wall_total_ms": wall_total_ms,
        "p95_wall_ms": p95_wall_ms,
        "quality_threshold": args.quality_threshold,
        "latency_target_ms": args.latency_target_ms,
        "minimum_headroom_ratio": args.minimum_headroom_ratio,
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
