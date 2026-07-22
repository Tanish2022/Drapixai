from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.quality.lower_body_benchmark import evaluate_lower_body_benchmark_case
from drapixai_ai.quality.tryon_scorer import TryOnScorer


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Score external lower-body VTON outputs with DrapixAI quality gates."
    )
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--result-name", default="output_00.png")
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def _resolve(path: str) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else REPO_ROOT / candidate


def main() -> None:
    args = _parse_args()
    manifest_path = args.manifest if args.manifest.is_absolute() else REPO_ROOT / args.manifest
    output_root = args.output_root if args.output_root.is_absolute() else REPO_ROOT / args.output_root
    report_path = args.report or output_root / "drapixai_score_summary.json"
    if not report_path.is_absolute():
        report_path = REPO_ROOT / report_path

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scorer = TryOnScorer()
    scored_cases: list[dict[str, object]] = []

    for index, case in enumerate(manifest.get("cases", []), start=1):
        slug = str(case["slug"])
        category = str(case["category"])
        result_path = output_root / f"{index:02d}_{slug}" / args.result_name
        if not result_path.is_file():
            scored_cases.append({"slug": slug, "category": category, "status": "missing", "result": str(result_path)})
            continue

        person = Image.open(_resolve(str(case["person_path"]))).convert("RGB")
        garment = Image.open(_resolve(str(case["garment_path"]))).convert("RGB")
        candidate = Image.open(result_path).convert("RGB")
        score = scorer.score_candidate(person, garment, candidate, garment_type=f"lower:{category}")
        gate = evaluate_lower_body_benchmark_case(
            person,
            candidate,
            category=category,
            quality_score=score.score,
            metrics=score.metrics,
            admin_status=str(case.get("admin_review", {}).get("status", "pending")),
        )
        scored_cases.append(
            {
                "slug": slug,
                "category": category,
                "status": "scored",
                "quality_score": score.score,
                "warnings": score.warnings,
                "metrics": score.metrics,
                "benchmark_gate": gate,
                "result": str(result_path),
            }
        )

    completed = [case for case in scored_cases if case["status"] == "scored"]
    report = {
        "manifest": str(manifest_path),
        "output_root": str(output_root),
        "case_count": len(scored_cases),
        "scored_count": len(completed),
        "average_quality_score": (
            sum(float(case["quality_score"]) for case in completed) / len(completed) if completed else None
        ),
        "automated_pass_count": sum(
            1 for case in completed if bool(case["benchmark_gate"]["passed_automated"])
        ),
        "cases": scored_cases,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(report_path)


if __name__ == "__main__":
    main()
