from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_benchmark import CATEGORY_STAGE, STAGE_ORDER


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", REPO_ROOT))
BENCHMARK_ROOT = APP_ROOT / "runtime" / "test_assets" / "lower_body_benchmark"
INTAKE_PATH = Path(os.getenv("DRAPIXAI_LOWER_BODY_BENCHMARK_INTAKE", BENCHMARK_ROOT / "intake.json"))
MANIFEST_PATH = Path(os.getenv("DRAPIXAI_LOWER_BODY_BENCHMARK_FILE", BENCHMARK_ROOT / "manifest.json"))
CATEGORY_ORDER = {category: index for index, category in enumerate(LOWER_BODY_CATEGORIES)}


def _resolve_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else APP_ROOT / path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if not INTAKE_PATH.is_file():
        raise FileNotFoundError(f"Missing lower-body benchmark intake: {INTAKE_PATH}")
    intake = json.loads(INTAKE_PATH.read_text(encoding="utf-8"))
    cases: list[dict[str, object]] = []

    for raw_case in intake.get("cases") or []:
        case = dict(raw_case)
        category = str(case.get("category") or "").strip().lower()
        if category not in LOWER_BODY_CATEGORIES:
            raise ValueError(f"Unsupported lower-body category: {category}")
        person_path = _resolve_path(str(case.get("person_path") or ""))
        garment_path = _resolve_path(str(case.get("garment_path") or ""))
        if not person_path.is_file() or not garment_path.is_file():
            raise FileNotFoundError(f"Missing benchmark assets for {case.get('slug')}: {person_path}, {garment_path}")

        provenance = dict(case.get("provenance") or {})
        person_provenance = dict(provenance.get("person") or {})
        garment_provenance = dict(provenance.get("garment") or {})
        person_provenance["sha256"] = _sha256(person_path)
        garment_provenance["sha256"] = _sha256(garment_path)
        provenance["person"] = person_provenance
        provenance["garment"] = garment_provenance

        case["category"] = category
        case["stage"] = CATEGORY_STAGE[category]
        case["benchmark_eligible"] = True
        case["provenance"] = provenance
        case.setdefault("admin_review", {"status": "pending", "reviewer": None, "notes": ""})
        cases.append(case)

    cases.sort(
        key=lambda case: (
            STAGE_ORDER[CATEGORY_STAGE[str(case["category"])]],
            CATEGORY_ORDER[str(case["category"])],
            str(case.get("slug") or ""),
        )
    )
    manifest = {
        "benchmark_version": "lower-real-v1",
        "release_policy": "internal_admin_review_only",
        "description": "Commercially cleared real-person and real-product lower-body benchmark.",
        "targets": {
            "minimum_cases_per_category": 12,
            "target_cases_per_category": 24,
            "minimum_automated_pass_rate": 0.90,
            "minimum_admin_approval_rate": 0.95,
            "required_consecutive_passing_runs": 2,
        },
        "stage_order": [
            "jeans_pants",
            "trousers_joggers",
            "shorts",
            "skirts",
            "leggings",
        ],
        "cases": cases,
    }
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(MANIFEST_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
