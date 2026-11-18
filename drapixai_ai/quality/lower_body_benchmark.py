from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from PIL import Image

from drapixai_ai.quality.lower_body_policy import (
    MINIMUM_RESULT_SCORE,
    is_unit_score,
    lower_body_blocking_warnings,
)

from drapixai_ai.preprocess.lower_body_regions import (
    build_lower_body_region_masks,
    lower_body_region_profile,
    normalize_lower_body_category,
)


@dataclass(frozen=True)
class LowerBodyBenchmarkThresholds:
    overall: float
    shape: float
    texture: float
    color: float
    context: float
    waist: float
    crotch: float
    knee: float
    hem: float
    ankle: float
    shoe: float


LOWER_BODY_BENCHMARK_THRESHOLDS: dict[str, LowerBodyBenchmarkThresholds] = {
    "jeans": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.82, 0.84, 0.86, 0.96, 0.62, 0.62, 0.60, 0.62, 0.60, 0.92),
    "pants": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.82, 0.82, 0.84, 0.96, 0.62, 0.60, 0.60, 0.62, 0.60, 0.92),
    "trousers": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.84, 0.84, 0.86, 0.96, 0.66, 0.62, 0.62, 0.66, 0.62, 0.92),
    "joggers": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.82, 0.80, 0.82, 0.96, 0.60, 0.58, 0.58, 0.64, 0.62, 0.94),
    "shorts": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.84, 0.82, 0.84, 0.97, 0.62, 0.62, 0.92, 0.66, 0.92, 0.94),
    "skirt": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.84, 0.84, 0.86, 0.97, 0.64, 0.00, 0.58, 0.68, 0.92, 0.94),
    "leggings": LowerBodyBenchmarkThresholds(MINIMUM_RESULT_SCORE, 0.86, 0.86, 0.86, 0.97, 0.66, 0.66, 0.64, 0.66, 0.64, 0.94),
}


def lower_body_metric_failures(category: str, values: dict[str, object]) -> list[str]:
    thresholds = asdict(LOWER_BODY_BENCHMARK_THRESHOLDS[category])
    return [
        name for name, threshold in thresholds.items()
        if not is_unit_score(values.get(name)) or values[name] < threshold
    ]


STAGE_ORDER = {
    "jeans_pants": 1,
    "trousers_joggers": 2,
    "shorts": 3,
    "skirts": 4,
    "leggings": 5,
}

CATEGORY_STAGE = {
    "jeans": "jeans_pants",
    "pants": "jeans_pants",
    "trousers": "trousers_joggers",
    "joggers": "trousers_joggers",
    "shorts": "shorts",
    "skirt": "skirts",
    "leggings": "leggings",
}


def evaluate_lower_body_benchmark_case(
    person: Image.Image,
    candidate: Image.Image,
    *,
    category: str,
    quality_score: float,
    metrics: dict[str, float],
    admin_status: str = "pending",
    warnings: object = (),
) -> dict[str, object]:
    normalized = normalize_lower_body_category(category)
    thresholds = LOWER_BODY_BENCHMARK_THRESHOLDS[normalized]
    profile = lower_body_region_profile(normalized)
    masks = build_lower_body_region_masks(candidate, normalized)
    score_metric_names = {
        "waistband_alignment", "crotch_artifact_score", "knee_preservation",
        "hem_alignment", "ankle_preservation", "shoe_preservation",
        "left_leg_integrity", "right_leg_integrity", "lower_garment_coverage",
        "edge_quality", "lower_garment_texture_similarity",
        "lower_garment_color_similarity", "face_preservation",
        "upper_body_preservation", "background_cast_score",
    }
    invalid_metrics = sorted(
        name for name in score_metric_names & metrics.keys() if not is_unit_score(metrics[name])
    )
    metrics = {
        name: value if name not in invalid_metrics else 0.0
        for name, value in metrics.items()
    }

    preservation = {
        name: _pixel_preservation(person, candidate, masks[name])
        for name in profile.preservation_regions
    }
    anatomy = {
        "waist": float(metrics.get("waistband_alignment", 0.0)),
        "crotch": float(metrics.get("crotch_artifact_score", 1.0 if normalized == "skirt" else 0.0)),
        "knee": (
            preservation.get("knee", float(metrics.get("knee_preservation", 0.0)))
        ),
        "hem": float(metrics.get("hem_alignment", 0.0)),
        "ankle": (
            preservation.get("ankle", float(metrics.get("ankle_preservation", 0.0)))
        ),
        "shoe": preservation.get("shoe", float(metrics.get("shoe_preservation", 0.0))),
    }

    leg_integrity = min(
        float(metrics.get("left_leg_integrity", 0.0)),
        float(metrics.get("right_leg_integrity", 0.0)),
    )
    coverage = float(metrics.get("lower_garment_coverage", 0.0))
    edge = float(metrics.get("edge_quality", 0.0))
    if normalized == "skirt":
        shape_parts = (anatomy["waist"], anatomy["knee"], anatomy["hem"], coverage, edge)
    elif normalized == "shorts":
        shape_parts = (anatomy["waist"], anatomy["crotch"], anatomy["hem"], anatomy["knee"], coverage, edge)
    else:
        shape_parts = (
            anatomy["waist"],
            anatomy["crotch"],
            anatomy["knee"],
            anatomy["hem"],
            anatomy["ankle"],
            leg_integrity,
            coverage,
            edge,
        )
    shape_score = float(sum(shape_parts) / len(shape_parts))
    texture_score = float(metrics.get("lower_garment_texture_similarity", 0.0))
    color_score = float(metrics.get("lower_garment_color_similarity", 0.0))
    context_score = min(
        float(metrics.get("face_preservation", 0.0)),
        float(metrics.get("upper_body_preservation", 0.0)),
        float(metrics.get("background_cast_score", 0.0)),
    )

    threshold_map = {
        "overall": thresholds.overall,
        "shape": thresholds.shape,
        "texture": thresholds.texture,
        "color": thresholds.color,
        "context": thresholds.context,
        "waist": thresholds.waist,
        "crotch": thresholds.crotch,
        "knee": thresholds.knee,
        "hem": thresholds.hem,
        "ankle": thresholds.ankle,
        "shoe": thresholds.shoe,
    }
    values = {
        "overall": quality_score if is_unit_score(quality_score) else None,
        "shape": shape_score,
        "texture": texture_score,
        "color": color_score,
        "context": context_score,
        **anatomy,
    }
    failed_metrics = lower_body_metric_failures(normalized, values)
    metric_pass = {name: name not in failed_metrics for name in threshold_map}
    blocking_warnings = lower_body_blocking_warnings(warnings, normalized)
    automated_passed = not failed_metrics and not invalid_metrics and not blocking_warnings
    admin_approved = admin_status.strip().lower() == "approved"

    return {
        "category": normalized,
        "stage": CATEGORY_STAGE[normalized],
        "stage_order": STAGE_ORDER[CATEGORY_STAGE[normalized]],
        "passed_automated": automated_passed,
        "passed_admin": admin_approved,
        "passed_release_gate": automated_passed and admin_approved,
        "admin_status": admin_status,
        "failed_metrics": failed_metrics,
        "invalid_metrics": invalid_metrics,
        "blocking_warnings": blocking_warnings,
        "metrics": values,
        "thresholds": threshold_map,
        "metric_pass": metric_pass,
        "preservation_regions": preservation,
    }


def _pixel_preservation(person: Image.Image, candidate: Image.Image, mask: Image.Image) -> float:
    size = candidate.size
    person_arr = np.asarray(person.convert("RGB").resize(size, Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    candidate_arr = np.asarray(candidate.convert("RGB"), dtype=np.float32) / 255.0
    region = np.asarray(mask.convert("L").resize(size, Image.Resampling.NEAREST)) > 127
    if not region.any():
        return 0.0
    difference = float(np.abs(person_arr[region] - candidate_arr[region]).mean())
    return float(max(0.0, min(1.0, 1.0 - difference * 3.0)))
