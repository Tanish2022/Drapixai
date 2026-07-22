from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from drapixai_ai.configs.settings import settings
from drapixai_ai.preprocess.mask_builder import build_lower_body_mask_for_category
from drapixai_ai.preprocess.lower_body_regions import build_lower_body_region_masks
from drapixai_ai.quality.tryon_scorer import TryOnScorer
from drapixai_ai.services.garment_preprocessor import (
    GarmentPreprocessOptions,
    GarmentValidationError,
    preprocess_garment,
)
from drapixai_ai.services.lower_body_validator import validate_lower_body_person


def _synthetic_person() -> bytes:
    image = Image.new("RGB", (768, 1152), (238, 238, 238))
    pixels = image.load()
    for y in range(80, 300):
        for x in range(310, 458):
            pixels[x, y] = (185, 138, 110)
    for y in range(285, 560):
        for x in range(260, 508):
            pixels[x, y] = (245, 245, 245)
    for y in range(500, 980):
        for x in range(255, 368):
            pixels[x, y] = (30, 70, 145)
        for x in range(400, 513):
            pixels[x, y] = (30, 70, 145)
    for y in range(500, 980):
        for x in (252, 255, 365, 368, 397, 400, 510, 513):
            pixels[x, y] = (8, 20, 60)
    for y in range(515, 955, 44):
        for x in range(258, 365):
            pixels[x, y] = (80, 120, 190)
        for x in range(403, 510):
            pixels[x, y] = (80, 120, 190)
    for y in range(500, 555):
        for x in range(252, 516):
            if y in (500, 502, 552, 554) or x in (252, 254, 514, 516):
                pixels[x, y] = (10, 24, 70)
    for y in range(560, 950):
        for x in range(382, 386):
            pixels[x, y] = (10, 24, 70)
    for y in range(980, 1060):
        for x in range(230, 382):
            pixels[x, y] = (30, 30, 30)
        for x in range(386, 538):
            pixels[x, y] = (30, 30, 30)
    for y in range(980, 1060):
        for x in (228, 230, 380, 382, 384, 386, 536, 538):
            pixels[x, y] = (5, 5, 5)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _synthetic_jeans() -> bytes:
    image = Image.new("RGBA", (900, 1300), (0, 0, 0, 0))
    pixels = image.load()
    for y in range(120, 1120):
        for x in range(230, 670):
            if not (500 < y < 700 and 410 < x < 490):
                pixels[x, y] = (35, 75, 150, 255)
    for x in range(230, 670):
        for y in range(120, 145):
            pixels[x, y] = (25, 55, 120, 255)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    person_bytes = _synthetic_person()
    garment_bytes = _synthetic_jeans()
    report: dict[str, object] = {
        "enable_lower_body": settings.enable_lower_body,
        "lower_body_cache_version": settings.lower_body_cache_version,
        "checks": {},
    }

    validation = validate_lower_body_person(person_bytes)
    report["checks"]["person_validation"] = {
        "ok": validation.ok,
        "reason": validation.reason,
        "warnings": validation.warnings,
    }
    if not validation.ok:
        raise SystemExit(json.dumps(report, indent=2))

    try:
        preprocess = preprocess_garment(
            garment_bytes,
            options=GarmentPreprocessOptions(category_hint="jeans", garment_type="lower"),
        )
        report["checks"]["preprocess"] = {
            "ok": True,
            "profile_key": preprocess.profile_key,
            "support_level": preprocess.support_level,
            "size": preprocess.image.size,
            "warnings": preprocess.warnings,
        }
    except GarmentValidationError as exc:
        report["checks"]["preprocess"] = {"ok": False, "reason": exc.reason}
        if settings.enable_lower_body:
            raise SystemExit(json.dumps(report, indent=2))
        if exc.reason != "LOWER_BODY_NOT_ENABLED":
            raise SystemExit(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return

    person = Image.open(io.BytesIO(person_bytes)).convert("RGB")
    garment = Image.open(io.BytesIO(garment_bytes)).convert("RGB")
    candidate = person.copy()
    categories = ["jeans", "pants", "trousers", "shorts", "skirt", "leggings", "joggers"]
    masks = {category: build_lower_body_mask_for_category(person, category) for category in categories}
    report["checks"]["mask"] = {
        "ok": all(mask.size == person.size for mask in masks.values()),
        "size": person.size,
        "categories": sorted(masks.keys()),
    }
    region_masks = {
        category: build_lower_body_region_masks(person, category)
        for category in categories
    }
    required_regions = {"waist", "crotch", "knee", "hem", "ankle", "shoe"}
    region_masks_ok = all(
        set(category_masks) == required_regions
        and all(mask.size == person.size and mask.getbbox() is not None for mask in category_masks.values())
        for category_masks in region_masks.values()
    )
    report["checks"]["anatomy_region_masks"] = {
        "ok": region_masks_ok,
        "mask_count": sum(len(category_masks) for category_masks in region_masks.values()),
        "regions": sorted(required_regions),
        "shorts_hem_bbox": region_masks["shorts"]["hem"].getbbox(),
        "trousers_hem_bbox": region_masks["trousers"]["hem"].getbbox(),
    }
    if not region_masks_ok or region_masks["shorts"]["hem"].getbbox() == region_masks["trousers"]["hem"].getbbox():
        raise SystemExit(json.dumps(report, indent=2))

    score = TryOnScorer().score_candidate(person, garment, candidate, garment_type="lower:jeans")
    report["checks"]["lower_scorer"] = {
        "ok": "waistband_alignment" in score.metrics and "shoe_preservation" in score.metrics,
        "score": score.score,
        "metric_keys": sorted(score.metrics.keys()),
        "warnings": score.warnings,
    }

    output_dir = Path("runtime") / "lower_body_v1_scaffold"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
