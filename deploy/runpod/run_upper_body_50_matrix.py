from __future__ import annotations

import json
import os
import time
import traceback
import urllib.request
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.services.garment_preprocessor import GarmentValidationError, preprocess_garment


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", Path.cwd()))
OUTPUT_ROOT = Path(os.getenv("DRAPIXAI_UPPER_BODY_50_DIR", APP_ROOT / "runtime" / "upper_body_50_matrix"))
CATVTON_EXAMPLE_ROOT = APP_ROOT / "drapixai_ai" / "third_party" / "CatVTON" / "resource" / "demo" / "example"


@dataclass(frozen=True)
class PersonSpec:
    slug: str
    gender: str
    body_profile: str
    pose_profile: str
    path: str


@dataclass(frozen=True)
class GarmentSpec:
    slug: str
    segment: str
    label: str
    source_url: str = ""
    local_path: str = ""
    notes: str = ""


@dataclass(frozen=True)
class MatrixCase:
    index: int
    slug: str
    person: PersonSpec
    garment: GarmentSpec


PEOPLE = [
    PersonSpec("men_model_5", "men", "average", "front_relaxed", "person/men/model_5.png"),
    PersonSpec("men_model_7", "men", "slim", "front_straight_arms", "person/men/model_7.png"),
    PersonSpec("men_simon_1", "men", "broad", "front_slight_bend", "person/men/Simon_1.png"),
    PersonSpec("men_yifeng_0", "men", "average", "front_relaxed", "person/men/Yifeng_0.png"),
    PersonSpec("women_049713", "women", "average", "front_straight_arms", "person/women/049713_0.jpg"),
    PersonSpec("women_model_3", "women", "slim", "front_relaxed", "person/women/1-model_3.png"),
    PersonSpec("women_model_4", "women", "average", "front_slight_bend", "person/women/2-model_4.png"),
    PersonSpec("women_model_8", "women", "broad", "front_relaxed", "person/women/model_8.png"),
]


GARMENTS = [
    # 8 shirts
    GarmentSpec("shirt_black_oversized", "shirt", "black oversized shirt", "https://wrogn.com/products/solid-oversized-casual-shirt-black-wtsh0381m", notes="dark solid"),
    GarmentSpec("shirt_black_textured", "shirt", "black textured shirt", "https://wrogn.com/products/solid-textured-comfort-fit-shirt-black-wush2852f", notes="dark texture"),
    GarmentSpec("shirt_khaki_linen", "shirt", "khaki linen shirt", "https://wrogn.com/products/solid-khaki-full-sleeve-shirt", notes="light neutral"),
    GarmentSpec("shirt_olive_linen", "shirt", "olive linen shirt", "https://wrogn.com/products/solid-linen-blend-shirt-olive-wvsh0094s-c", notes="green/olive"),
    GarmentSpec("shirt_blue_linen", "shirt", "blue slim linen shirt", "https://wrogn.com/products/solid-slim-fit-linen-shirt-blue-wsh01fssl0579s", notes="blue solid"),
    GarmentSpec("shirt_blue_checks", "shirt", "blue checked shirt", "https://wrogn.com/products/textured-checks-cotton-shirt-blue-wtsh9691w", notes="checked"),
    GarmentSpec("shirt_green_folded_cuff", "shirt", "green folded cuff shirt", "https://m.media-amazon.com/images/I/71a-0tfK5PL._SL1500_.jpg", notes="direct image folded cuff"),
    GarmentSpec("shirt_local_white_blouse", "shirt", "white shirt/blouse local", local_path="condition/upper/23255574_53383833_1000.jpg", notes="white garment"),
    # 8 t-shirts
    GarmentSpec("tshirt_offwhite_typographic", "tshirt", "off white typographic t-shirt", "https://wrogn.com/products/the-wrogn-mind-printed-t-shirt", notes="graphic"),
    GarmentSpec("tshirt_offwhite_heavy_print", "tshirt", "off white heavy print t-shirt", "https://wrogn.com/products/wrogn-begins-here-printed-t-shirt", notes="graphic"),
    GarmentSpec("tshirt_offwhite_back_print", "tshirt", "off white back printed t-shirt", "https://wrogn.com/products/wrogn-canvas-off-white-oversized-t-shirt", notes="oversized"),
    GarmentSpec("tshirt_white_graphic", "tshirt", "white oversized graphic t-shirt", "https://wrogn.com/products/oversized-graphic-t-shirt-by-wrogn-statement-placement-print-white-wuts5317m", notes="white graphic"),
    GarmentSpec("tshirt_green_fade", "tshirt", "green fade oversized t-shirt", "https://wrogn.com/products/wrogn-fade-oversized-t-shirt", notes="green color"),
    GarmentSpec("tshirt_light_blue", "tshirt", "light blue t-shirt", "https://wrogn.com/products/wrogn-champ-printed-t-shirt", notes="light color"),
    GarmentSpec("tshirt_black_placement", "tshirt", "black placement printed t-shirt", "https://wrogn.com/products/oversized-placement-printed-t-shirt-black-wuts5409m", notes="dark graphic"),
    GarmentSpec("tshirt_local_graphic", "tshirt", "local graphic t-shirt", local_path="condition/upper/24083449_54173465_2048.jpg", notes="local graphic"),
    # 6 polos
    GarmentSpec("polo_grey", "polo", "grey polo", "https://wrogn.com/products/perfectly-grey-polo-t-shirt"),
    GarmentSpec("polo_rust_oversized", "polo", "rust oversized polo", "https://wrogn.com/products/classic-oversized-polo-t-shirt-rust-wvts9141mp"),
    GarmentSpec("polo_black_solid", "polo", "black solid polo", "https://wrogn.com/products/sharp-solid-polo-t-shirt"),
    GarmentSpec("polo_dark_green", "polo", "dark green polo", "https://wrogn.com/products/solid-oversized-polo-t-shirt-dark-green-wuts1711m"),
    GarmentSpec("polo_white_striped", "polo", "white striped polo", "https://wrogn.com/products/striped-polo-t-shirt-white-wuts2641f"),
    GarmentSpec("polo_green_textured", "polo", "green textured polo", "https://wrogn.com/products/solid-textured-slim-fit-polo-t-shirt-green-wuts9088w-a"),
    # 6 hoodies/sweatshirts
    GarmentSpec("hoodie_blue", "hoodie", "blue hoodie", "https://wrogn.com/products/wrogn-enough-blue-hoodie"),
    GarmentSpec("hoodie_black", "hoodie", "black hoodie", "https://wrogn.com/products/wrogn-enough-black-hoodie"),
    GarmentSpec("hoodie_light_green", "hoodie", "light green hoodie", "https://wrogn.com/products/solid-regular-fit-hoodie-light-green-wvss9996nw-d"),
    GarmentSpec("sweatshirt_black_print", "hoodie", "black printed sweatshirt", "https://wrogn.com/products/classic-black-back-printed-sweatshirt"),
    GarmentSpec("sweatshirt_black_comfort", "hoodie", "black comfort sweatshirt", "https://wrogn.com/products/wrogn-graphic-printed-comfort-fit-sweatshirt-black-wvss9092f"),
    GarmentSpec("hoodie_black_graphic", "hoodie", "black graphic hoodie sweatshirt", "https://wrogn.com/products/wrogn-comfort-fit-graphic-hoodie-sweatshirt-black-wvss9077f"),
    # 6 blouses/tops
    GarmentSpec("top_local_plain_light", "blouse_top", "local plain light top", local_path="condition/upper/21514384_52353349_1000.jpg"),
    GarmentSpec("top_local_printed_dark", "blouse_top", "local printed dark top", local_path="condition/upper/22790049_53294275_1000.jpg"),
    GarmentSpec("top_pink_foliage", "blouse_top", "pink foliage short top", "https://www.libas.in/products/pink-printed-cotton-a-line-short-kurti-43001"),
    GarmentSpec("top_pink_aline", "blouse_top", "pink a-line top", "https://www.libas.in/products/pink-printed-cotton-a-line-short-kurti-43029"),
    GarmentSpec("top_blue_aline", "blouse_top", "blue a-line top", "https://www.libas.in/products/blue-printed-cotton-a-line-short-kurti-43031"),
    GarmentSpec("top_local_white", "blouse_top", "local white blouse", local_path="condition/upper/23255574_53383833_1000.jpg"),
    # 6 short kurtis
    GarmentSpec("kurti_charcoal_printed", "short_kurti", "charcoal printed short kurti", "https://www.libas.in/products/chalcoal-grey-cotton-printed-short-kurti"),
    GarmentSpec("kurti_blue_abstract", "short_kurti", "blue abstract short kurti", "https://www.libas.in/products/blue-abstract-printed-cotton-a-line-short-kurti-98342"),
    GarmentSpec("kurti_multi_printed", "short_kurti", "multi printed short kurti", "https://www.libas.in/products/multi-printed-cotton-straight-short-kurti-29371or"),
    GarmentSpec("kurti_red_anarkali", "short_kurti", "red anarkali short kurti", "https://www.libas.in/products/red-printed-cotton-anarkali-short-kurti-29386o"),
    GarmentSpec("kurti_green_straight", "short_kurti", "green straight short kurti", "https://www.libas.in/products/green-printed-cotton-straight-short-kurti-29534"),
    GarmentSpec("kurti_olive_straight", "short_kurti", "olive straight short kurti", "https://www.libas.in/collections/short-kurtis/products/olive-printed-cotton-straight-short-kurti-98267"),
    # 4 sleeveless tops
    GarmentSpec("sleeveless_pink", "sleeveless_top", "pink sleeveless short kurti", "https://www.libas.in/products/pink-printed-cotton-anarkali-short-kurti-29377o"),
    GarmentSpec("sleeveless_blue_blend", "sleeveless_top", "blue sleeveless short kurti", "https://www.libas.in/products/blue-printed-cotton-blend-straight-short-kurti-98256h"),
    GarmentSpec("sleeveless_navy", "sleeveless_top", "navy sleeveless short kurti", "https://www.libas.in/products/navy-blue-printed-cotton-straight-short-kurti-98269r"),
    GarmentSpec("sleeveless_local_print", "sleeveless_top", "local printed top sleeveless check", local_path="condition/upper/22790049_53294275_1000.jpg"),
    # 6 edge cases
    GarmentSpec("edge_green_shirt", "edge_case", "green folded cuff shirt", "https://m.media-amazon.com/images/I/71a-0tfK5PL._SL1500_.jpg", notes="green shade fidelity"),
    GarmentSpec("edge_white_polo", "edge_case", "white striped polo", "https://wrogn.com/products/striped-polo-t-shirt-white-wuts2641f", notes="white garment"),
    GarmentSpec("edge_black_shirt", "edge_case", "black oversized shirt", "https://wrogn.com/products/solid-oversized-casual-shirt-black-wtsh0381m", notes="black garment"),
    GarmentSpec("edge_busy_kurti", "edge_case", "busy multi print kurti", "https://www.libas.in/products/multi-printed-cotton-straight-short-kurti-29371or", notes="busy print"),
    GarmentSpec("edge_low_contrast", "edge_case", "khaki low contrast shirt", "https://wrogn.com/products/solid-khaki-full-sleeve-shirt", notes="low contrast"),
    GarmentSpec("edge_structured_collar", "edge_case", "structured blue linen shirt", "https://wrogn.com/products/solid-slim-fit-linen-shirt-blue-wsh01fssl0579s", notes="structured collar"),
]


def _request_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def _shopify_json_url(product_url: str) -> str:
    parsed = urlparse(product_url)
    parts = [part for part in parsed.path.split("/") if part]
    if "products" not in parts:
        return product_url
    handle = parts[parts.index("products") + 1]
    return f"{parsed.scheme}://{parsed.netloc}/products/{handle}.js"


def _resolve_garment_bytes(garment: GarmentSpec) -> tuple[bytes, str]:
    if garment.local_path:
        path = CATVTON_EXAMPLE_ROOT / garment.local_path
        return path.read_bytes(), str(path)

    if not garment.source_url:
        raise ValueError(f"No source URL or local path for {garment.slug}")

    if garment.source_url.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        return _request_bytes(garment.source_url), garment.source_url

    product_json_url = _shopify_json_url(garment.source_url)
    product_payload = json.loads(_request_bytes(product_json_url).decode("utf-8"))
    images = product_payload.get("images") or []
    if not images:
        raise ValueError(f"No Shopify images found for {garment.source_url}")
    image_url = images[0]
    if image_url.startswith("//"):
        image_url = f"https:{image_url}"
    return _request_bytes(image_url), image_url


def _load_person(person: PersonSpec) -> Image.Image:
    path = CATVTON_EXAMPLE_ROOT / person.path
    if not path.exists():
        raise FileNotFoundError(f"Missing bundled person asset: {path}")
    return Image.open(path).convert("RGB")


def _load_image(image_bytes: bytes) -> Image.Image:
    return Image.open(BytesIO(image_bytes)).convert("RGB")


def _save_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _build_cases() -> list[MatrixCase]:
    cases: list[MatrixCase] = []
    for index, garment in enumerate(GARMENTS, start=1):
        person = PEOPLE[(index - 1) % len(PEOPLE)]
        cases.append(
            MatrixCase(
                index=index,
                slug=f"{index:02d}_{garment.segment}_{garment.slug}_{person.slug}",
                person=person,
                garment=garment,
            )
        )
    return cases


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    cases = _build_cases()
    start = int(os.getenv("DRAPIXAI_MATRIX_START", "0") or "0")
    limit = int(os.getenv("DRAPIXAI_MATRIX_LIMIT", "0") or "0")
    selected_cases = cases[start:]
    if limit > 0:
        selected_cases = selected_cases[:limit]

    pipeline = DrapixAITryOnPipeline()
    summary: list[dict[str, object]] = []
    expected_counts: dict[str, int] = {}
    for garment in GARMENTS:
        expected_counts[garment.segment] = expected_counts.get(garment.segment, 0) + 1

    for case in selected_cases:
        case_dir = OUTPUT_ROOT / case.slug
        case_dir.mkdir(parents=True, exist_ok=True)
        entry: dict[str, object] = {
            "index": case.index,
            "slug": case.slug,
            "person": asdict(case.person),
            "garment": asdict(case.garment),
            "status": "pending",
            "quality_mode": "standard",
            "settings": {
                "engine": settings.tryon_engine,
                "inference_steps": settings.inference_steps,
                "guidance_scale": settings.guidance_scale,
                "input_max_side": settings.input_max_side,
                "min_quality_score": settings.min_quality_score,
                "target_tryon_ms": settings.target_tryon_ms,
            },
        }
        try:
            person = _load_person(case.person)
            person.save(case_dir / "person.png", format="PNG")
            garment_bytes, resolved_garment_url = _resolve_garment_bytes(case.garment)
            (case_dir / "garment_source.bin").write_bytes(garment_bytes)
            entry["resolved_garment_url"] = resolved_garment_url

            try:
                preprocess = preprocess_garment(garment_bytes)
                entry["preprocess"] = {
                    "mode": "strict",
                    "did_process": preprocess.did_process,
                    "reason": preprocess.reason,
                    "warnings": preprocess.warnings,
                }
            except GarmentValidationError as exc:
                preprocess = preprocess_garment(garment_bytes, bypass_validation=True)
                entry["preprocess"] = {
                    "mode": "bypass_validation",
                    "original_error": exc.reason,
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
                garment_type="upper",
                quality="standard",
            )
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            result.image.save(case_dir / "result.png", format="PNG")
            entry["status"] = "succeeded"
            entry["latency_ms"] = latency_ms
            entry["result_metadata"] = {
                "engine": result.engine,
                "quality_score": result.quality_score,
                "candidate_count": result.candidate_count,
                "candidate_scores": result.candidate_scores,
                "warnings": result.warnings,
                "metadata": result.metadata,
            }
        except Exception as exc:  # noqa: BLE001
            entry["status"] = "failed"
            entry["error"] = str(exc)
            entry["traceback"] = traceback.format_exc()

        summary.append(entry)
        _save_json(case_dir / "summary.json", entry)
        print(f"{case.slug}: {entry['status']}")

    succeeded = sum(1 for item in summary if item["status"] == "succeeded")
    failed = sum(1 for item in summary if item["status"] == "failed")
    report = {
        "output_root": str(OUTPUT_ROOT),
        "total_defined_cases": len(cases),
        "selected_cases": len(selected_cases),
        "succeeded": succeeded,
        "failed": failed,
        "expected_segment_counts": expected_counts,
        "cases": summary,
    }
    _save_json(OUTPUT_ROOT / "summary.json", report)
    print(OUTPUT_ROOT / "summary.json")


if __name__ == "__main__":
    main()
