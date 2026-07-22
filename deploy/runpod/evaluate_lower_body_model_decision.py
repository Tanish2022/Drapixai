from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from pathlib import Path


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", Path(__file__).resolve().parents[2]))
REPORT_PATH = Path(
    os.getenv(
        "DRAPIXAI_LOWER_BODY_MODEL_DECISION_REPORT",
        APP_ROOT / "runtime" / "lower_body_model_decision.json",
    )
)
REQUIRED_RUNS = int(os.getenv("DRAPIXAI_LOWER_BODY_REQUIRED_PASSING_RUNS", "2"))


def _summary_paths() -> list[Path]:
    raw = os.getenv("DRAPIXAI_LOWER_BODY_BENCHMARK_SUMMARIES", "")
    if not raw.strip():
        return []
    paths: list[Path] = []
    for value in raw.split(os.pathsep):
        path = Path(value)
        paths.append(path if path.is_absolute() else APP_ROOT / path)
    return paths


def main() -> int:
    summaries: list[dict[str, object]] = []
    missing: list[str] = []
    for path in _summary_paths():
        if not path.is_file():
            missing.append(str(path))
            continue
        summaries.append(json.loads(path.read_text(encoding="utf-8")))

    category_failures: dict[str, Counter[str]] = defaultdict(Counter)
    category_run_passes: Counter[str] = Counter()
    eligible_counts: Counter[str] = Counter()
    for summary in summaries:
        for category, category_report in dict(summary.get("category_summary") or {}).items():
            eligible_counts[str(category)] = min(
                eligible_counts.get(str(category), 10**9),
                int(category_report.get("eligible_cases") or 0),
            )
            if bool(category_report.get("consistent_quality_gate_passed")):
                category_run_passes[str(category)] += 1
        for case in summary.get("cases") or []:
            if not bool(case.get("benchmark_eligible")):
                continue
            gate = dict(case.get("benchmark_gate") or {})
            category = str(case.get("category") or "unknown")
            category_failures[category].update(str(name) for name in gate.get("failed_metrics") or [])

    enough_runs = len(summaries) >= REQUIRED_RUNS
    categories = sorted(set(eligible_counts) | set(category_failures))
    all_categories_pass = bool(categories) and all(
        category_run_passes[category] >= REQUIRED_RUNS for category in categories
    )
    shape_failures = sum(counter["shape"] for counter in category_failures.values())
    texture_failures = sum(counter["texture"] for counter in category_failures.values())

    if missing or not enough_runs or not categories:
        decision = "insufficient_real_data"
        action = "Complete the commercially cleared benchmark and run CatVTON at least twice."
    elif all_categories_pass:
        decision = "retain_catvton"
        action = "Keep CatVTON as the lower-body engine and continue internal admin review."
    elif shape_failures > 0:
        decision = "add_stronger_lower_body_baseline"
        action = (
            "Keep CatVTON as the measured baseline and benchmark a stronger bottoms-capable engine. "
            "FASHN VTON v1.5 is the first integration candidate; fine-tune only after the same cases "
            "show whether model replacement resolves silhouette failures."
        )
    elif texture_failures > 0:
        decision = "fine_tune_or_add_texture_adapter"
        action = "Retain CatVTON architecture and evaluate lower-body fine-tuning or a texture-preservation adapter."
    else:
        decision = "retain_internal_baseline_only"
        action = "Keep CatVTON internal while resolving non-shape quality gates and rerun the benchmark."

    report = {
        "decision": decision,
        "action": action,
        "engine_under_test": "catvton",
        "stronger_candidate": "fashn-vton-1.5",
        "required_consecutive_runs": REQUIRED_RUNS,
        "summaries_loaded": len(summaries),
        "missing_summaries": missing,
        "categories": {
            category: {
                "minimum_eligible_cases_across_runs": eligible_counts[category],
                "consistent_passing_runs": category_run_passes[category],
                "failure_counts": dict(category_failures[category]),
            }
            for category in categories
        },
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(REPORT_PATH)
    return 0 if decision == "retain_catvton" else 2


if __name__ == "__main__":
    raise SystemExit(main())
