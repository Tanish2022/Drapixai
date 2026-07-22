from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.postprocess.quality_boosters import apply_quality_boosters
from drapixai_ai.preprocess.mask_builder import build_lower_body_mask_for_category
from drapixai_ai.quality.tryon_scorer import TryOnScorer


SOURCE_ROOT = Path(
    os.getenv(
        "DRAPIXAI_REPROCESS_SOURCE",
        REPO_ROOT / "runtime" / "runpod_lower_body_real_person_matrix",
    )
)
OUTPUT_ROOT = Path(
    os.getenv(
        "DRAPIXAI_REPROCESS_OUTPUT",
        REPO_ROOT / "runtime" / "lower_body_reprocessed",
    )
)


def _outside_difference(person: Image.Image, result: Image.Image, category: str) -> float:
    person_resized = person.convert("RGB").resize(result.size, Image.Resampling.LANCZOS)
    mask = build_lower_body_mask_for_category(person_resized, category).convert("L")
    outside = np.asarray(mask, dtype=np.uint8) < 8
    if not outside.any():
        return 0.0
    person_arr = np.asarray(person_resized, dtype=np.float32)
    result_arr = np.asarray(result.convert("RGB"), dtype=np.float32)
    return float(np.abs(person_arr[outside] - result_arr[outside]).mean())


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    scorer = TryOnScorer()
    report: list[dict[str, object]] = []

    for case_dir in sorted(path for path in SOURCE_ROOT.iterdir() if path.is_dir()):
        summary_path = case_dir / "summary.json"
        person_path = case_dir / "person.png"
        garment_path = case_dir / "garment_processed.png"
        result_path = case_dir / "result.png"
        if not all(path.is_file() for path in (summary_path, person_path, garment_path, result_path)):
            continue

        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        category = str(summary.get("category") or "pants")
        person = Image.open(person_path).convert("RGB")
        garment = Image.open(garment_path).convert("RGB")
        original = Image.open(result_path).convert("RGB")
        corrected = apply_quality_boosters(
            original,
            person=person,
            garment=garment,
            garment_type=f"lower:{category}",
        )

        corrected_path = OUTPUT_ROOT / f"{case_dir.name}.png"
        corrected.save(corrected_path, format="PNG")
        before_score = scorer.score_candidate(person, garment, original, garment_type=f"lower:{category}")
        after_score = scorer.score_candidate(person, garment, corrected, garment_type=f"lower:{category}")
        report.append(
            {
                "case": case_dir.name,
                "category": category,
                "before_score": before_score.score,
                "after_score": after_score.score,
                "before_outside_difference": _outside_difference(person, original, category),
                "after_outside_difference": _outside_difference(person, corrected, category),
                "before_metrics": before_score.metrics,
                "after_metrics": after_score.metrics,
                "output": str(corrected_path),
            }
        )

    report_path = OUTPUT_ROOT / "summary.json"
    report_path.write_text(json.dumps({"cases": report}, indent=2), encoding="utf-8")
    print(report_path)


if __name__ == "__main__":
    main()
