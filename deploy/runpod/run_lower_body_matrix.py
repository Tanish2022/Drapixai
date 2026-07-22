from __future__ import annotations

import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.preprocess.lower_body_regions import build_lower_body_region_masks
from drapixai_ai.quality.lower_body_benchmark import (
    CATEGORY_STAGE,
    STAGE_ORDER,
    evaluate_lower_body_benchmark_case,
)
from drapixai_ai.services.garment_preprocessor import (
    GarmentPreprocessOptions,
    GarmentValidationError,
    preprocess_garment,
)
from drapixai_ai.services.lower_body_validator import validate_lower_body_person


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", REPO_ROOT))
MATRIX_FILE = Path(os.getenv("DRAPIXAI_LOWER_BODY_MATRIX_FILE", APP_ROOT / "runtime" / "test_assets" / "lower_body_matrix.json"))
OUTPUT_ROOT = Path(os.getenv("DRAPIXAI_LOWER_BODY_MATRIX_DIR", APP_ROOT / "runtime" / "lower_body_matrix"))
ALLOW_BYPASS_VALIDATION = os.getenv("DRAPIXAI_LOWER_BODY_MATRIX_ALLOW_BYPASS", "0") == "1"
FAIL_ON_QUALITY = os.getenv("DRAPIXAI_LOWER_BODY_MATRIX_FAIL_ON_QUALITY", "1") == "1"
MIN_CASES_PER_CATEGORY = int(os.getenv("DRAPIXAI_LOWER_BODY_BENCHMARK_MIN_CASES", "12"))
MIN_CATEGORY_PASS_RATE = float(os.getenv("DRAPIXAI_LOWER_BODY_BENCHMARK_PASS_RATE", "0.90"))


@dataclass(frozen=True)
class LowerBodyCase:
    slug: str
    person_path: Path
    garment_path: Path
    category: str
    notes: str = ""
    benchmark_eligible: bool = False
    admin_status: str = "pending"
    provenance: dict[str, object] | None = None


def _resolve_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return APP_ROOT / path


def _load_cases() -> list[LowerBodyCase]:
    if not MATRIX_FILE.exists():
        raise FileNotFoundError(
            f"Missing lower-body matrix file: {MATRIX_FILE}. "
            "Create JSON with items containing slug, person_path, garment_path, and category."
        )
    payload = json.loads(MATRIX_FILE.read_text(encoding="utf-8"))
    raw_items = payload.get("cases", payload if isinstance(payload, list) else [])
    cases: list[LowerBodyCase] = []
    for index, item in enumerate(raw_items, start=1):
        category = str(item.get("category") or item.get("garment_category") or "jeans").strip().lower()
        cases.append(
            LowerBodyCase(
                slug=str(item.get("slug") or f"{index:02d}_{category}"),
                person_path=_resolve_path(str(item["person_path"])),
                garment_path=_resolve_path(str(item["garment_path"])),
                category=category,
                notes=str(item.get("notes") or ""),
                benchmark_eligible=bool(item.get("benchmark_eligible", False)),
                admin_status=str((item.get("admin_review") or {}).get("status") or "pending"),
                provenance=dict(item.get("provenance") or {}),
            )
        )
    return cases


def _save_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    if not settings.enable_lower_body:
        raise RuntimeError("Set DRAPIXAI_ENABLE_LOWER_BODY=1 before running the lower-body V1 matrix.")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    cases = _load_cases()
    start = int(os.getenv("DRAPIXAI_MATRIX_START", "0") or "0")
    limit = int(os.getenv("DRAPIXAI_MATRIX_LIMIT", "0") or "0")
    selected_cases = cases[start:]
    if limit > 0:
        selected_cases = selected_cases[:limit]

    pipeline = DrapixAITryOnPipeline()
    summary: list[dict[str, object]] = []

    for index, case in enumerate(selected_cases, start=start + 1):
        case_dir = OUTPUT_ROOT / f"{index:02d}_{case.slug}"
        case_dir.mkdir(parents=True, exist_ok=True)
        entry: dict[str, object] = {
            "index": index,
            "slug": case.slug,
            "category": case.category,
            "person_path": str(case.person_path),
            "garment_path": str(case.garment_path),
            "notes": case.notes,
            "stage": CATEGORY_STAGE.get(case.category, "jeans_pants"),
            "stage_order": STAGE_ORDER.get(CATEGORY_STAGE.get(case.category, "jeans_pants"), 1),
            "benchmark_eligible": case.benchmark_eligible,
            "admin_status": case.admin_status,
            "provenance": case.provenance,
            "status": "pending",
            "quality_mode": "standard",
            "garment_type": "lower",
            "settings": {
                "engine": settings.tryon_engine,
                "inference_steps": settings.inference_steps,
                "guidance_scale": settings.guidance_scale,
                "min_quality_score": settings.min_quality_score,
                "lower_body_allowed_categories": settings.lower_body_allowed_categories,
                "lower_body_cache_version": settings.lower_body_cache_version,
                "allow_bypass_validation": ALLOW_BYPASS_VALIDATION,
            },
        }

        try:
            person_bytes = case.person_path.read_bytes()
            person_validation = validate_lower_body_person(person_bytes)
            entry["person_validation"] = {
                "ok": person_validation.ok,
                "reason": person_validation.reason,
                "warnings": person_validation.warnings,
                "width": person_validation.width,
                "height": person_validation.height,
            }
            if not person_validation.ok:
                raise ValueError(f"LOWER_BODY_INVALID:{person_validation.reason}")

            person = Image.open(case.person_path).convert("RGB")
            person.save(case_dir / "person.png", format="PNG")

            garment_bytes = case.garment_path.read_bytes()
            try:
                preprocess = preprocess_garment(
                    garment_bytes,
                    options=GarmentPreprocessOptions(category_hint=case.category, garment_type="lower"),
                )
                entry["preprocess"] = {
                    "mode": "strict",
                    "profile_key": preprocess.profile_key,
                    "profile_label": preprocess.profile_label,
                    "support_level": preprocess.support_level,
                    "did_process": preprocess.did_process,
                    "reason": preprocess.reason,
                    "warnings": preprocess.warnings,
                }
            except GarmentValidationError as exc:
                if not ALLOW_BYPASS_VALIDATION:
                    raise
                preprocess = preprocess_garment(
                    garment_bytes,
                    bypass_validation=True,
                    options=GarmentPreprocessOptions(category_hint=case.category, garment_type="lower"),
                )
                entry["preprocess"] = {
                    "mode": "bypass_validation",
                    "original_error": exc.reason,
                    "profile_key": preprocess.profile_key,
                    "profile_label": preprocess.profile_label,
                    "support_level": preprocess.support_level,
                    "did_process": preprocess.did_process,
                    "reason": preprocess.reason,
                    "warnings": preprocess.warnings,
                }

            garment = preprocess.image.convert("RGB")
            garment.save(case_dir / "garment_processed.png", format="PNG")

            started_at = time.perf_counter()
            result = pipeline.run_tryon_with_metadata(
                person,
                garment,
                inference_steps=settings.inference_steps,
                guidance_scale=settings.guidance_scale,
                garment_type=f"lower:{case.category}",
                quality="standard",
            )
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            result.image.save(case_dir / "result.png", format="PNG")
            region_dir = case_dir / "region_masks"
            region_dir.mkdir(exist_ok=True)
            for region_name, region_mask in build_lower_body_region_masks(result.image, case.category).items():
                region_mask.save(region_dir / f"{region_name}.png", format="PNG")
            entry["status"] = "succeeded"
            entry["latency_ms"] = latency_ms
            safety_blocked = bool(result.metadata.get("safety_blocked")) or "SAFETY_CHECK_BLOCKED" in result.warnings
            quality_passed = result.quality_score >= settings.min_quality_score and not safety_blocked
            entry["quality_gate"] = {
                "passed": quality_passed,
                "threshold": settings.min_quality_score,
                "safety_blocked": safety_blocked,
            }
            entry["result_metadata"] = {
                "engine": result.engine,
                "quality_score": result.quality_score,
                "candidate_count": result.candidate_count,
                "candidate_scores": result.candidate_scores,
                "warnings": result.warnings,
                "metadata": result.metadata,
            }
            entry["benchmark_gate"] = evaluate_lower_body_benchmark_case(
                person,
                result.image,
                category=case.category,
                quality_score=result.quality_score,
                metrics={
                    key: float(value)
                    for key, value in result.metadata.items()
                    if isinstance(value, (int, float))
                },
                admin_status=case.admin_status,
            )
        except Exception as exc:  # noqa: BLE001
            entry["status"] = "failed"
            entry["error"] = str(exc)
            entry["traceback"] = traceback.format_exc()

        summary.append(entry)
        _save_json(case_dir / "summary.json", entry)
        print(f"{case.slug}: {entry['status']}")

    succeeded = sum(1 for item in summary if item["status"] == "succeeded")
    failed = sum(1 for item in summary if item["status"] == "failed")
    quality_scores = [
        float(item["result_metadata"]["quality_score"])
        for item in summary
        if item.get("status") == "succeeded" and isinstance(item.get("result_metadata"), dict)
    ]
    latencies = [
        int(item["latency_ms"])
        for item in summary
        if item.get("status") == "succeeded" and item.get("latency_ms") is not None
    ]
    quality_passed = sum(
        1
        for item in summary
        if item.get("status") == "succeeded"
        and isinstance(item.get("quality_gate"), dict)
        and bool(item["quality_gate"].get("passed"))
    )
    quality_failed = succeeded - quality_passed
    category_summary: dict[str, dict[str, object]] = {}
    for category in sorted({str(item.get("category")) for item in summary}):
        category_cases = [item for item in summary if item.get("category") == category]
        eligible = [item for item in category_cases if item.get("benchmark_eligible")]
        automated_passed = sum(
            1 for item in eligible
            if isinstance(item.get("benchmark_gate"), dict) and item["benchmark_gate"].get("passed_automated")
        )
        release_passed = sum(
            1 for item in eligible
            if isinstance(item.get("benchmark_gate"), dict) and item["benchmark_gate"].get("passed_release_gate")
        )
        automated_rate = automated_passed / len(eligible) if eligible else 0.0
        release_rate = release_passed / len(eligible) if eligible else 0.0
        category_summary[category] = {
            "stage": CATEGORY_STAGE.get(category),
            "cases": len(category_cases),
            "eligible_cases": len(eligible),
            "minimum_cases": MIN_CASES_PER_CATEGORY,
            "automated_passed": automated_passed,
            "automated_pass_rate": automated_rate,
            "admin_and_automated_passed": release_passed,
            "release_pass_rate": release_rate,
            "consistent_quality_gate_passed": (
                len(eligible) >= MIN_CASES_PER_CATEGORY
                and automated_rate >= MIN_CATEGORY_PASS_RATE
                and release_rate >= MIN_CATEGORY_PASS_RATE
            ),
        }
    all_categories_consistent = bool(category_summary) and all(
        bool(item["consistent_quality_gate_passed"])
        for item in category_summary.values()
    )

    report = {
        "matrix_file": str(MATRIX_FILE),
        "output_root": str(OUTPUT_ROOT),
        "selected_cases": len(selected_cases),
        "succeeded": succeeded,
        "failed": failed,
        "quality_passed": quality_passed,
        "quality_failed": quality_failed,
        "launch_gate_passed": failed == 0 and quality_failed == 0,
        "internal_benchmark_only": True,
        "public_release_gate_passed": False,
        "all_categories_consistent": all_categories_consistent,
        "minimum_cases_per_category": MIN_CASES_PER_CATEGORY,
        "minimum_category_pass_rate": MIN_CATEGORY_PASS_RATE,
        "category_summary": category_summary,
        "fail_on_quality": FAIL_ON_QUALITY,
        "average_quality_score": sum(quality_scores) / len(quality_scores) if quality_scores else None,
        "average_latency_ms": sum(latencies) / len(latencies) if latencies else None,
        "warm_average_latency_ms": sum(latencies[1:]) / len(latencies[1:]) if len(latencies) > 1 else None,
        "cases": summary,
    }
    _save_json(OUTPUT_ROOT / "summary.json", report)
    print(OUTPUT_ROOT / "summary.json")
    if failed or (FAIL_ON_QUALITY and quality_failed):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
