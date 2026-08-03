from __future__ import annotations

import hashlib
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_benchmark import CATEGORY_STAGE, STAGE_ORDER


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", REPO_ROOT))
MANIFEST_PATH = Path(
    os.getenv(
        "DRAPIXAI_LOWER_BODY_BENCHMARK_FILE",
        APP_ROOT / "runtime" / "test_assets" / "lower_body_benchmark" / "manifest.json",
    )
)
REPORT_PATH = Path(
    os.getenv(
        "DRAPIXAI_LOWER_BODY_BENCHMARK_VALIDATION_REPORT",
        APP_ROOT / "runtime" / "lower_body_benchmark_validation.json",
    )
)

REQUIRED_ATTRIBUTES = ("pose", "body_shape", "background", "color_family", "texture", "fit")
ALLOWED_RIGHTS = {"owned", "licensed_commercial", "merchant_supplied", "model_release"}


def _resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else APP_ROOT / path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_asset(
    case_slug: str,
    role: str,
    path: Path,
    provenance: dict[str, object],
) -> list[str]:
    errors: list[str] = []
    if not path.is_file():
        errors.append(f"{case_slug}:{role}:MISSING_FILE:{path}")
        return errors
    if bool(provenance.get("synthetic", True)):
        errors.append(f"{case_slug}:{role}:SYNTHETIC_ASSET_NOT_ALLOWED")
    if str(provenance.get("rights") or "") not in ALLOWED_RIGHTS:
        errors.append(f"{case_slug}:{role}:UNAPPROVED_RIGHTS")
    if not str(provenance.get("source_id") or "").strip():
        errors.append(f"{case_slug}:{role}:SOURCE_ID_REQUIRED")
    expected_hash = str(provenance.get("sha256") or "").strip().lower()
    if not expected_hash:
        errors.append(f"{case_slug}:{role}:SHA256_REQUIRED")
    elif expected_hash != _sha256(path):
        errors.append(f"{case_slug}:{role}:SHA256_MISMATCH")
    if role == "person" and str(provenance.get("consent") or "") not in {"confirmed", "model_release"}:
        errors.append(f"{case_slug}:{role}:CONSENT_REQUIRED")
    return errors


def main() -> int:
    if not MANIFEST_PATH.is_file():
        raise FileNotFoundError(f"Missing benchmark manifest: {MANIFEST_PATH}")
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    targets = payload.get("targets") or {}
    minimum_cases = int(targets.get("minimum_cases_per_category", 12))
    target_cases = int(targets.get("target_cases_per_category", 24))
    raw_cases = payload.get("cases") or []

    errors: list[str] = []
    warnings: list[str] = []
    slugs: set[str] = set()
    eligible_by_category: Counter[str] = Counter()
    diversity: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    last_stage = 0

    for index, case in enumerate(raw_cases, start=1):
        slug = str(case.get("slug") or f"case-{index}")
        category = str(case.get("category") or "").strip().lower()
        if slug in slugs:
            errors.append(f"{slug}:DUPLICATE_SLUG")
        slugs.add(slug)
        if category not in LOWER_BODY_CATEGORIES:
            errors.append(f"{slug}:UNSUPPORTED_CATEGORY:{category}")
            continue

        stage = str(case.get("stage") or CATEGORY_STAGE[category])
        if stage != CATEGORY_STAGE[category]:
            errors.append(f"{slug}:WRONG_STAGE:{stage}")
        stage_order = STAGE_ORDER[CATEGORY_STAGE[category]]
        if stage_order < last_stage:
            errors.append(f"{slug}:STAGE_ORDER_REGRESSION")
        last_stage = max(last_stage, stage_order)

        if not bool(case.get("benchmark_eligible", False)):
            warnings.append(f"{slug}:NOT_BENCHMARK_ELIGIBLE")
            continue
        eligible_by_category[category] += 1

        attributes = dict(case.get("attributes") or {})
        for name in REQUIRED_ATTRIBUTES:
            value = str(attributes.get(name) or "").strip().lower()
            if not value:
                errors.append(f"{slug}:ATTRIBUTE_REQUIRED:{name}")
            else:
                diversity[category][name].add(value)

        provenance = dict(case.get("provenance") or {})
        person_path = _resolve_path(str(case.get("person_path") or ""))
        garment_path = _resolve_path(str(case.get("garment_path") or ""))
        errors.extend(_validate_asset(slug, "person", person_path, dict(provenance.get("person") or {})))
        errors.extend(_validate_asset(slug, "garment", garment_path, dict(provenance.get("garment") or {})))

    category_report: dict[str, dict[str, object]] = {}
    for category in LOWER_BODY_CATEGORIES:
        count = eligible_by_category[category]
        if count < minimum_cases:
            errors.append(f"{category}:INSUFFICIENT_CASES:{count}/{minimum_cases}")
        category_diversity = {
            name: len(diversity[category][name])
            for name in REQUIRED_ATTRIBUTES
        }
        for name, unique_count in category_diversity.items():
            if count and unique_count < 2:
                errors.append(f"{category}:INSUFFICIENT_DIVERSITY:{name}:{unique_count}/2")
        category_report[category] = {
            "stage": CATEGORY_STAGE[category],
            "eligible_cases": count,
            "minimum_cases": minimum_cases,
            "target_cases": target_cases,
            "diversity": category_diversity,
            "intake_ready": count >= minimum_cases and all(value >= 2 for value in category_diversity.values()),
        }

    report = {
        "manifest": str(MANIFEST_PATH),
        "manifest_sha256": _sha256(MANIFEST_PATH),
        "benchmark_version": payload.get("benchmark_version"),
        "release_policy": payload.get("release_policy"),
        "valid": not errors,
        "case_count": len(raw_cases),
        "eligible_case_count": sum(eligible_by_category.values()),
        "errors": errors,
        "warnings": warnings,
        "categories": category_report,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(REPORT_PATH)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
