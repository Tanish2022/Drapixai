from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

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
    "jeans": LowerBodyBenchmarkThresholds(0.90, 0.82, 0.84, 0.86, 0.96, 0.62, 0.62, 0.60, 0.62, 0.60, 0.92),
    "pants": LowerBodyBenchmarkThresholds(0.90, 0.82, 0.82, 0.84, 0.96, 0.62, 0.60, 0.60, 0.62, 0.60, 0.92),
    "trousers": LowerBodyBenchmarkThresholds(0.91, 0.84, 0.84, 0.86, 0.96, 0.66, 0.62, 0.62, 0.66, 0.62, 0.92),
    "joggers": LowerBodyBenchmarkThresholds(0.89, 0.82, 0.80, 0.82, 0.96, 0.60, 0.58, 0.58, 0.64, 0.62, 0.94),
    "shorts": LowerBodyBenchmarkThresholds(0.90, 0.84, 0.82, 0.84, 0.97, 0.62, 0.62, 0.92, 0.66, 0.92, 0.94),
    "skirt": LowerBodyBenchmarkThresholds(0.90, 0.84, 0.84, 0.86, 0.97, 0.64, 0.00, 0.58, 0.68, 0.92, 0.94),
    "leggings": LowerBodyBenchmarkThresholds(0.92, 0.86, 0.86, 0.86, 0.97, 0.66, 0.66, 0.64, 0.66, 0.64, 0.94),
}


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
) -> dict[str, object]:
    normalized = normalize_lower_body_category(category)
    thresholds = LOWER_BODY_BENCHMARK_THRESHOLDS[normalized]
    profile = lower_body_region_profile(normalized)
    masks = build_lower_body_region_masks(candidate, normalized)

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
        "overall": float(quality_score),
        "shape": shape_score,
        "texture": texture_score,
        "color": color_score,
        "context": context_score,
        **anatomy,
    }
    metric_pass = {name: values[name] >= threshold for name, threshold in threshold_map.items()}
    failed_metrics = [name for name, passed in metric_pass.items() if not passed]
    admin_approved = admin_status.strip().lower() == "approved"

    return {
        "category": normalized,
        "stage": CATEGORY_STAGE[normalized],
        "stage_order": STAGE_ORDER[CATEGORY_STAGE[normalized]],
        "passed_automated": not failed_metrics,
        "passed_admin": admin_approved,
        "passed_release_gate": not failed_metrics and admin_approved,
        "admin_status": admin_status,
        "failed_metrics": failed_metrics,
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
