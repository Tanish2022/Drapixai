from __future__ import annotations

import json
import os
import traceback
import urllib.request
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.services.garment_preprocessor import (
    GarmentValidationError,
    preprocess_garment,
)


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", Path.cwd()))
BASE = Path(os.getenv("DRAPIXAI_TEST_MATRIX_DIR", APP_ROOT / "runtime" / "test_matrix"))
CATVTON_EXAMPLE_ROOT = APP_ROOT / "drapixai_ai" / "third_party" / "CatVTON" / "resource" / "demo" / "example"


@dataclass(frozen=True)
class Case:
    slug: str
    gender: str
    garment_type: str
    person_source: str
    garment_source: str
    person_url: str = ""
    garment_url: str = ""
    person_path: str = ""
    garment_path: str = ""


REMOTE_CASES = [
    Case(
        slug="men_tshirt_black",
        gender="men",
        garment_type="tshirt",
        person_url="https://images.pexels.com/photos/20594701/pexels-photo-20594701.jpeg?auto=compress&cs=tinysrgb&w=800",
        garment_url="https://wrogn.com/cdn/shop/files/1_16e2557a-78f0-450b-a890-800eb8115440.webp?v=1766953286",
        person_source="https://www.pexels.com/photo/portrait-of-man-in-shirt-20594701/",
        garment_source="https://wrogn.com/products/solid-regular-fit-t-shirt-black-wvts9054mp",
    ),
    Case(
        slug="men_shirt_blue_checks",
        gender="men",
        garment_type="shirt",
        person_url="https://images.pexels.com/photos/20594701/pexels-photo-20594701.jpeg?auto=compress&cs=tinysrgb&w=800",
        garment_url="https://wrogn.com/cdn/shop/files/WTSH9691W.webp?v=1744624168",
        person_source="https://www.pexels.com/photo/portrait-of-man-in-shirt-20594701/",
        garment_source="https://wrogn.com/products/textured-checks-cotton-shirt-blue-wtsh9691w",
    ),
    Case(
        slug="men_hoodie_blue",
        gender="men",
        garment_type="hoodie",
        person_url="https://images.pexels.com/photos/20594701/pexels-photo-20594701.jpeg?auto=compress&cs=tinysrgb&w=800",
        garment_url="https://wrogn.com/cdn/shop/files/1_796ec63e-ecd6-419e-a646-459e304d8b42.jpg?v=1704543393",
        person_source="https://www.pexels.com/photo/portrait-of-man-in-shirt-20594701/",
        garment_source="https://wrogn.com/products/wrogn-enough-blue-hoodie",
    ),
    Case(
        slug="women_short_kurti_pink",
        gender="women",
        garment_type="short-kurti",
        person_url="https://images.pexels.com/photos/20797546/pexels-photo-20797546.jpeg?auto=compress&cs=tinysrgb&w=800",
        garment_url="https://cdn.shopify.com/s/files/1/0341/4805/7228/files/29387_2Main_da1289d6-b266-465b-88c6-c9e47d65763f.webp?v=1757862179",
        person_source="https://www.pexels.com/photo/portrait-of-woman-in-top-20797546/",
        garment_source="https://www.libas.in/products/pink-printed-cotton-anarkali-short-kurti-29387or",
    ),
    Case(
        slug="women_short_kurti_green",
        gender="women",
        garment_type="short-kurti",
        person_url="https://images.pexels.com/photos/20797546/pexels-photo-20797546.jpeg?auto=compress&cs=tinysrgb&w=800",
        garment_url="https://cdn.shopify.com/s/files/1/0341/4805/7228/files/29881_1_baebd071-17dd-4aac-a206-727dde9f02ef.jpg?v=1755939237",
        person_source="https://www.pexels.com/photo/portrait-of-woman-in-top-20797546/",
        garment_source="https://www.libas.in/products/green-printed-cotton-straight-short-kurti-29881",
    ),
    Case(
        slug="women_long_kurta_black",
        gender="women",
        garment_type="kurta",
        person_url="https://images.pexels.com/photos/20797546/pexels-photo-20797546.jpeg?auto=compress&cs=tinysrgb&w=800",
        garment_url="https://cdn.shopify.com/s/files/1/0341/4805/7228/files/black-solid-chanderi-silk-kurta-libas-1.jpg?v=1738916019",
        person_source="https://www.pexels.com/photo/portrait-of-woman-in-top-20797546/",
        garment_source="https://www.libas.in/products/black-solid-chanderi-silk-kurta-22143o-libas",
    ),
]


LOCAL_PEOPLE = [
    ("cat_men_model_5", "men", "person/men/model_5.png"),
    ("cat_men_model_7", "men", "person/men/model_7.png"),
    ("cat_men_simon_1", "men", "person/men/Simon_1.png"),
    ("cat_men_yifeng_0", "men", "person/men/Yifeng_0.png"),
    ("cat_women_049713_0", "women", "person/women/049713_0.jpg"),
    ("cat_women_model_3", "women", "person/women/1-model_3.png"),
    ("cat_women_model_4", "women", "person/women/2-model_4.png"),
    ("cat_women_model_8", "women", "person/women/model_8.png"),
]

LOCAL_UPPER_GARMENTS = [
    ("plain_tshirt_light", "tshirt", "condition/upper/21514384_52353349_1000.jpg"),
    ("printed_top_dark", "printed-top", "condition/upper/22790049_53294275_1000.jpg"),
    ("white_blouse", "blouse", "condition/upper/23255574_53383833_1000.jpg"),
    ("graphic_tshirt", "graphic-tshirt", "condition/upper/24083449_54173465_2048.jpg"),
]

LOCAL_CASES = [
    Case(
        slug=f"{person_slug}_{garment_slug}",
        gender=gender,
        garment_type=garment_type,
        person_source="CatVTON bundled demo person asset",
        garment_source="CatVTON bundled demo upper-body garment asset",
        person_path=str(CATVTON_EXAMPLE_ROOT / person_path),
        garment_path=str(CATVTON_EXAMPLE_ROOT / garment_path),
    )
    for person_slug, gender, person_path in LOCAL_PEOPLE
    for garment_slug, garment_type, garment_path in LOCAL_UPPER_GARMENTS
]

CASES = REMOTE_CASES + LOCAL_CASES


def _download_image(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _load_image_bytes(case: Case, source: str) -> bytes:
    path_value = case.person_path if source == "person" else case.garment_path
    url_value = case.person_url if source == "person" else case.garment_url
    if path_value:
        return Path(path_value).read_bytes()
    return _download_image(url_value)


def _load_person(image_bytes: bytes) -> Image.Image:
    return Image.open(BytesIO(image_bytes)).convert("RGB")


def _save_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    BASE.mkdir(parents=True, exist_ok=True)
    pipeline = DrapixAITryOnPipeline()
    summary: list[dict[str, object]] = []
    start = int(os.getenv("DRAPIXAI_TEST_MATRIX_START", "0") or "0")
    limit = int(os.getenv("DRAPIXAI_TEST_MATRIX_LIMIT", "0") or "0")
    selected_cases = CASES[start:]
    cases = selected_cases[:limit] if limit > 0 else selected_cases

    for case in cases:
        case_dir = BASE / case.slug
        case_dir.mkdir(parents=True, exist_ok=True)
        entry: dict[str, object] = asdict(case)
        entry["status"] = "pending"
        entry["settings"] = {
            "engine": settings.tryon_engine,
            "candidate_count": settings.candidate_count,
            "min_quality_score": settings.min_quality_score,
            "input_max_side": settings.input_max_side,
            "enhanced_steps": settings.enhanced_inference_steps,
            "enhanced_guidance": settings.enhanced_guidance_scale,
        }
        try:
            person_bytes = _load_image_bytes(case, "person")
            garment_bytes = _load_image_bytes(case, "garment")
            (case_dir / "person.bin").write_bytes(person_bytes)
            (case_dir / "garment_raw.bin").write_bytes(garment_bytes)

            person = _load_person(person_bytes)
            person.save(case_dir / "person.png", format="PNG")

            strict_result = None
            strict_error = None
            try:
                strict_result = preprocess_garment(garment_bytes)
                entry["preprocess"] = {
                    "mode": "strict",
                    "did_process": strict_result.did_process,
                    "reason": strict_result.reason,
                }
            except GarmentValidationError as exc:
                strict_error = exc.reason
                entry["preprocess"] = {
                    "mode": "strict",
                    "error": exc.reason,
                }

            if strict_result is None:
                diagnostic_result = preprocess_garment(garment_bytes, bypass_validation=True)
                cloth = diagnostic_result.image.convert("RGB")
                entry["preprocess_fallback"] = {
                    "mode": "bypass_validation",
                    "did_process": diagnostic_result.did_process,
                    "reason": diagnostic_result.reason,
                    "original_error": strict_error,
                }
                entry["diagnostic_only"] = True
            else:
                cloth = strict_result.image.convert("RGB")
                entry["diagnostic_only"] = False

            cloth.save(case_dir / "garment_processed.png", format="PNG")

            result_with_metadata = pipeline.run_tryon_with_metadata(
                person,
                cloth,
                inference_steps=settings.enhanced_inference_steps,
                guidance_scale=settings.enhanced_guidance_scale,
                garment_type="upper",
            )
            result = result_with_metadata.image
            result.save(case_dir / "result.png", format="PNG")
            entry["result_metadata"] = {
                "engine": result_with_metadata.engine,
                "quality_score": result_with_metadata.quality_score,
                "candidate_count": result_with_metadata.candidate_count,
                "candidate_scores": result_with_metadata.candidate_scores,
                "warnings": result_with_metadata.warnings,
            }
            entry["status"] = "succeeded"
        except Exception as exc:  # noqa: BLE001
            entry["status"] = "failed"
            entry["error"] = str(exc)
            entry["traceback"] = traceback.format_exc()

        summary.append(entry)
        _save_json(case_dir / "summary.json", entry)

    _save_json(BASE / "summary.json", summary)
    print(BASE / "summary.json")


if __name__ == "__main__":
    main()
