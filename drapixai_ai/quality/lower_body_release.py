from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import math
from statistics import mean
from typing import Iterable

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_benchmark import lower_body_metric_failures
from drapixai_ai.quality.lower_body_policy import (
    MINIMUM_ADMIN_PASS_RATE,
    MINIMUM_AUTOMATED_PASS_RATE,
    MINIMUM_CASES_PER_CATEGORY,
    MINIMUM_RELEASE_RUNS,
    MINIMUM_RESULT_SCORE,
    is_unit_score,
    lower_body_blocking_warnings,
)
from drapixai_ai.services.lower_body_run_context import validate_run_context


RATING_FIELDS = (
    "realism",
    "garment_fidelity",
    "identity_preservation",
    "background_preservation",
)
REQUIRED_APPROVALS = (
    "fashn_vton_code_and_weights",
    "human_parser_model_license",
    "dwpose_license_and_attribution",
    "benchmark_asset_rights",
    "privacy_and_retention",
    "security_review",
)


def _case_passes_automated(case: dict[str, object]) -> bool:
    category = case.get("category")
    if category not in LOWER_BODY_CATEGORIES or case.get("status") != "succeeded":
        return False
    result = dict(case.get("result_metadata") or {})
    gate = dict(case.get("benchmark_gate") or {})
    metrics = dict(gate.get("metrics") or {})
    person_validation = dict(case.get("person_validation") or {})
    score = result.get("quality_score")
    return (
        is_unit_score(score)
        and score >= MINIMUM_RESULT_SCORE
        and metrics.get("overall") == score
        and not lower_body_metric_failures(category, metrics)
        and not lower_body_blocking_warnings(result.get("warnings"), category)
        and gate.get("passed_automated") is True
        and not gate.get("invalid_metrics")
        and not gate.get("blocking_warnings")
        and dict(case.get("preprocess") or {}).get("mode") == "strict"
        and dict(case.get("settings") or {}).get("allow_bypass_validation") is False
        and person_validation.get("ok") is True
        and person_validation.get("pose_checked") is True
        and type(person_validation.get("person_count")) is int
        and person_validation["person_count"] == 1
        and person_validation.get("pose_backend") == "dwpose_onnx_cpu"
    )


def _review_is_approved(review: dict[str, object]) -> bool:
    return (
        review.get("status") == "approved"
        and bool(str(review.get("reviewer") or "").strip())
        and isinstance(review.get("severe_failures"), list)
        and not review["severe_failures"]
        and all(
            isinstance(review.get(field), int)
            and not isinstance(review[field], bool)
            and 4 <= review[field] <= 5
            for field in RATING_FIELDS
        )
    )


def _category_rates(cases: list[dict[str, object]]) -> tuple[float, float, float]:
    if not cases:
        return 0.0, 0.0, 0.0
    automated = [_case_passes_automated(case) for case in cases]
    approved = [_review_is_approved(dict(case.get("admin_review") or {})) for case in cases]
    count = len(cases)
    return (
        sum(automated) / count,
        sum(approved) / count,
        sum(auto and admin for auto, admin in zip(automated, approved)) / count,
    )


def apply_admin_reviews(
    source_summary: dict[str, object],
    review_document: dict[str, object],
    *,
    minimum_admin_rate: float = 0.95,
) -> tuple[dict[str, object], list[str]]:
    if not is_unit_score(minimum_admin_rate) or minimum_admin_rate < MINIMUM_ADMIN_PASS_RATE:
        raise ValueError("MINIMUM_ADMIN_RATE_BELOW_POLICY")
    summary = deepcopy(source_summary)
    reviews = dict(review_document.get("reviews") or {})
    errors: list[str] = []
    eligible_cases = [case for case in summary.get("cases") or [] if case.get("benchmark_eligible")]
    expected_slugs = {str(case.get("slug")) for case in eligible_cases}
    if len(expected_slugs) != len(eligible_cases):
        errors.append("DUPLICATE_CASE_SLUG")
    review_slugs = set(reviews)

    run_id = str(summary.get("run_id") or "").strip()
    review_run_id = str(review_document.get("run_id") or "").strip()
    engine = str(summary.get("engine") or "").strip()
    review_engine = str(review_document.get("engine") or "").strip()
    if not run_id or review_run_id != run_id:
        errors.append("REVIEW_RUN_ID_MISMATCH")
    if not engine or review_engine != engine:
        errors.append("REVIEW_ENGINE_MISMATCH")
    for slug in sorted(expected_slugs - review_slugs):
        errors.append(f"{slug}:REVIEW_MISSING")
    for slug in sorted(review_slugs - expected_slugs):
        errors.append(f"{slug}:UNEXPECTED_REVIEW")

    by_category: dict[str, list[dict[str, object]]] = defaultdict(list)
    severe_failure_count = 0
    for case in eligible_cases:
        slug = str(case.get("slug"))
        category = str(case.get("category"))
        review = dict(reviews.get(slug) or {})
        status = str(review.get("status") or "").lower()
        reviewer = str(review.get("reviewer") or "").strip()
        severe_failures = [str(value).strip() for value in review.get("severe_failures") or [] if str(value).strip()]
        severe_failure_count += len(severe_failures)
        valid_ratings = True

        if status not in {"approved", "rejected"}:
            errors.append(f"{slug}:REVIEW_STATUS_REQUIRED")
        if not reviewer:
            errors.append(f"{slug}:REVIEWER_REQUIRED")
        for field in RATING_FIELDS:
            value = review.get(field)
            if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 5:
                valid_ratings = False
                errors.append(f"{slug}:RATING_REQUIRED:{field}")
        if status == "approved" and valid_ratings and any(int(review[field]) < 4 for field in RATING_FIELDS):
            errors.append(f"{slug}:APPROVAL_RATING_BELOW_GATE")

        if not isinstance(review.get("severe_failures"), list):
            errors.append(f"{slug}:SEVERE_FAILURE_REVIEW_REQUIRED")
        approved = _review_is_approved(review)
        case["admin_status"] = status or "missing"
        case["admin_review"] = {**review, "approved": approved}
        gate = dict(case.get("benchmark_gate") or {})
        gate.update(
            {
                "admin_status": status or "missing",
                "passed_admin": approved,
                "passed_release_gate": _case_passes_automated(case) and approved,
            }
        )
        case["benchmark_gate"] = gate
        by_category[category].append(case)

    for category, cases in by_category.items():
        report = dict((summary.get("category_summary") or {}).get(category) or {})
        approved = sum(1 for case in cases if (case.get("admin_review") or {}).get("approved"))
        released = sum(1 for case in cases if (case.get("benchmark_gate") or {}).get("passed_release_gate"))
        count = len(cases)
        admin_rate = approved / count if count else 0.0
        automated_rate, _, release_rate = _category_rates(cases)
        automated_minimum = max(MINIMUM_AUTOMATED_PASS_RATE, float(
            report.get("minimum_category_pass_rate")
            or summary.get("minimum_category_pass_rate")
            or MINIMUM_AUTOMATED_PASS_RATE
        ))
        report.update(
            {
                "admin_reviewed": count,
                "eligible_cases": count,
                "automated_pass_rate": automated_rate,
                "admin_approved": approved,
                "admin_pass_rate": admin_rate,
                "admin_and_automated_passed": released,
                "release_pass_rate": release_rate,
                "minimum_admin_pass_rate": minimum_admin_rate,
                "consistent_quality_gate_passed": (
                    count >= max(MINIMUM_CASES_PER_CATEGORY, int(report.get("minimum_cases") or summary.get("minimum_cases_per_category") or MINIMUM_CASES_PER_CATEGORY))
                    and automated_rate >= automated_minimum
                    and admin_rate >= minimum_admin_rate
                    and release_rate >= minimum_admin_rate
                ),
            }
        )
        summary.setdefault("category_summary", {})[category] = report

    complete = not errors and review_slugs == expected_slugs
    summary["admin_review"] = {
        "run_id": review_run_id,
        "engine": review_engine,
        "complete": complete,
        "errors": errors,
        "reviewed_cases": len(review_slugs & expected_slugs),
        "expected_cases": len(expected_slugs),
        "severe_failure_count": severe_failure_count,
    }
    summary["all_categories_consistent"] = set(by_category) == set(LOWER_BODY_CATEGORIES) and all(
        bool((summary.get("category_summary") or {}).get(category, {}).get("consistent_quality_gate_passed"))
        for category in LOWER_BODY_CATEGORIES
    )
    summary["public_release_gate_passed"] = False
    summary["eligible_for_release_evaluation"] = complete
    return summary, errors


def evaluate_release_evidence(
    intake_report: dict[str, object],
    source_summaries: Iterable[dict[str, object]],
    *,
    release_approvals: dict[str, object] | None = None,
    required_runs: int = 2,
    maximum_latency_p95_ms: int = 35_000,
) -> dict[str, object]:
    if isinstance(required_runs, bool) or not isinstance(required_runs, int) or required_runs < MINIMUM_RELEASE_RUNS:
        raise ValueError("AT_LEAST_TWO_RELEASE_RUNS_REQUIRED")
    if (
        isinstance(maximum_latency_p95_ms, bool)
        or not isinstance(maximum_latency_p95_ms, (int, float))
        or not math.isfinite(maximum_latency_p95_ms)
        or not 0 < maximum_latency_p95_ms <= 35_000
    ):
        raise ValueError("INVALID_RELEASE_LATENCY_LIMIT")
    summaries = list(source_summaries)
    evaluated = summaries[-required_runs:] if required_runs > 0 else []
    blockers: list[str] = []
    expected_categories = set(LOWER_BODY_CATEGORIES)
    approvals = dict((release_approvals or {}).get("approvals") or {})

    if intake_report.get("valid") is not True:
        blockers.append("BENCHMARK_INTAKE_INVALID")
    intake_cases = intake_report.get("eligible_case_ids") or []
    expected_cases = {
        (str(case.get("slug") or ""), str(case.get("category") or ""))
        for case in intake_cases
    }
    if not expected_cases or len(expected_cases) != len(intake_cases) or any(
        not slug or category not in expected_categories for slug, category in expected_cases
    ):
        blockers.append("BENCHMARK_CASE_IDENTITIES_INVALID")
    for category in sorted(expected_categories):
        if sum(item_category == category for _, item_category in expected_cases) < MINIMUM_CASES_PER_CATEGORY:
            blockers.append(f"{category}:INTAKE_INSUFFICIENT_CASES")
    if len(summaries) < required_runs:
        blockers.append(f"INSUFFICIENT_RUNS:{len(summaries)}/{required_runs}")
    for area in REQUIRED_APPROVALS:
        approval = dict(approvals.get(area) or {})
        if (
            str(approval.get("status") or "").lower() != "approved"
            or not str(approval.get("approver") or "").strip()
            or not str(approval.get("evidence_ref") or "").strip()
        ):
            blockers.append(f"RELEASE_APPROVAL_MISSING:{area}")

    engines = {str(item.get("engine") or "") for item in evaluated}
    matrix_hashes = {str(item.get("matrix_sha256") or "") for item in evaluated}
    versions = {str(item.get("benchmark_version") or "") for item in evaluated}
    seeds = {item.get("seed") for item in evaluated}
    run_ids = [str(item.get("run_id") or "").strip() for item in evaluated]
    if any(not value for value in run_ids) or len(set(run_ids)) != len(run_ids):
        blockers.append("RUN_IDS_NOT_DISTINCT")
    expected_hash = str(intake_report.get("manifest_sha256") or "")
    expected_version = str(intake_report.get("benchmark_version") or "")
    if len(engines) != 1 or "" in engines:
        blockers.append("RUN_ENGINE_MISMATCH")
    if len(matrix_hashes) != 1 or "" in matrix_hashes or (expected_hash and matrix_hashes != {expected_hash}):
        blockers.append("BENCHMARK_HASH_MISMATCH")
    if len(versions) != 1 or "" in versions or (expected_version and versions != {expected_version}):
        blockers.append("BENCHMARK_VERSION_MISMATCH")
    if len(evaluated) == required_runs and (None in seeds or len(seeds) != required_runs):
        blockers.append("BENCHMARK_SEEDS_NOT_DISTINCT")
    if any(isinstance(seed, bool) or not isinstance(seed, int) or seed < 0 for seed in seeds):
        blockers.append("BENCHMARK_SEED_INVALID")
    contexts = [item.get("run_context_sha256") for item in evaluated]
    if len(set(contexts)) != 1 or not contexts or not contexts[0]:
        blockers.append("RUN_CONTEXT_MISMATCH")

    run_reports: list[dict[str, object]] = []
    for index, summary in enumerate(evaluated, start=max(1, len(summaries) - len(evaluated) + 1)):
        run_id = str(summary.get("run_id") or f"run-{index}")
        run_blockers: list[str] = []
        if not validate_run_context(summary.get("run_context"), summary.get("run_context_sha256")):
            run_blockers.append("RUN_CONTEXT_INVALID")
        review = dict(summary.get("admin_review") or {})
        if not bool(review.get("complete")) or not bool(summary.get("eligible_for_release_evaluation")):
            run_blockers.append("ADMIN_REVIEW_INCOMPLETE")
        if int(review.get("severe_failure_count") or 0) > 0:
            run_blockers.append("SEVERE_FAILURES_PRESENT")
        all_cases = list(summary.get("cases") or [])
        cases = [case for case in all_cases if case.get("benchmark_eligible") is True]
        case_ids = [(str(case.get("slug") or ""), str(case.get("category") or "")) for case in cases]
        if len(set(case_ids)) != len(case_ids) or len({slug for slug, _ in case_ids}) != len(case_ids):
            run_blockers.append("DUPLICATE_CASE_SLUG")
        if set(case_ids) != expected_cases:
            run_blockers.append("BENCHMARK_CASE_SET_MISMATCH")
        if any(case.get("run_context_sha256") != summary.get("run_context_sha256") for case in all_cases):
            run_blockers.append("CASE_RUN_CONTEXT_MISMATCH")
        if any(case.get("status") != "succeeded" for case in all_cases) or summary.get("failed") != 0:
            run_blockers.append("INFERENCE_FAILURES_PRESENT")
        if any(
            bool(dict(case.get("admin_review") or {}).get("severe_failures"))
            for case in cases
        ):
            run_blockers.append("SEVERE_FAILURES_PRESENT")
        latency = summary.get("latency_p95_ms")
        if not isinstance(latency, (int, float)) or isinstance(latency, bool) or not math.isfinite(latency) or latency <= 0:
            run_blockers.append("LATENCY_P95_MISSING")
        elif float(latency) > maximum_latency_p95_ms:
            run_blockers.append(f"LATENCY_P95_EXCEEDED:{int(latency)}/{maximum_latency_p95_ms}")

        categories = dict(summary.get("category_summary") or {})
        measured_categories: dict[str, object] = {}
        if set(categories) != expected_categories:
            run_blockers.append("CATEGORY_SET_INCOMPLETE")
        for category in sorted(expected_categories):
            report = dict(categories.get(category) or {})
            minimum_cases = max(MINIMUM_CASES_PER_CATEGORY, int(report.get("minimum_cases") or summary.get("minimum_cases_per_category") or MINIMUM_CASES_PER_CATEGORY))
            automated_minimum = max(MINIMUM_AUTOMATED_PASS_RATE, float(summary.get("minimum_category_pass_rate") or MINIMUM_AUTOMATED_PASS_RATE))
            admin_minimum = max(MINIMUM_ADMIN_PASS_RATE, float(summary.get("minimum_admin_pass_rate") or MINIMUM_ADMIN_PASS_RATE))
            category_cases = [case for case in cases if case.get("category") == category]
            automated_rate, admin_rate, release_rate = _category_rates(category_cases)
            measured_categories[category] = {
                "eligible_cases": len(category_cases),
                "minimum_cases": minimum_cases,
                "automated_pass_rate": automated_rate,
                "admin_pass_rate": admin_rate,
                "release_pass_rate": release_rate,
                "minimum_result_quality_score": MINIMUM_RESULT_SCORE,
            }
            if len(category_cases) < minimum_cases:
                run_blockers.append(f"{category}:INSUFFICIENT_CASES")
            if automated_rate < automated_minimum:
                run_blockers.append(f"{category}:AUTOMATED_RATE_FAILED")
            if admin_rate < admin_minimum:
                run_blockers.append(f"{category}:ADMIN_RATE_FAILED")
            if release_rate < admin_minimum:
                run_blockers.append(f"{category}:COMBINED_RATE_FAILED")
            if not bool(report.get("consistent_quality_gate_passed")):
                run_blockers.append(f"{category}:CONSISTENCY_FAILED")
        blockers.extend(f"{run_id}:{blocker}" for blocker in run_blockers)
        run_reports.append({
            "run_id": run_id,
            "passed": not run_blockers,
            "blockers": run_blockers,
            "measured_categories": measured_categories,
        })

    eligible = len(evaluated) == required_runs and not blockers
    return {
        "decision": "eligible_for_manual_public_enable" if eligible else "blocked",
        "public_feature_flag_changed": False,
        "engine": next(iter(engines)) if len(engines) == 1 else None,
        "required_consecutive_runs": required_runs,
        "evaluated_runs": len(evaluated),
        "maximum_latency_p95_ms": maximum_latency_p95_ms,
        "minimum_result_quality_score": MINIMUM_RESULT_SCORE,
        "minimum_cases_per_category": MINIMUM_CASES_PER_CATEGORY,
        "benchmark_version": expected_version or None,
        "benchmark_sha256": expected_hash or None,
        "release_approvals_complete": not any(
            blocker.startswith("RELEASE_APPROVAL_MISSING:") for blocker in blockers
        ),
        "blockers": blockers,
        "runs": run_reports,
    }


def calibrate_metrics(
    summaries: Iterable[dict[str, object]],
    *,
    minimum_per_label: int = 6,
) -> dict[str, object]:
    observations: dict[str, dict[str, list[tuple[float, bool]]]] = defaultdict(lambda: defaultdict(list))
    for summary in summaries:
        for case in summary.get("cases") or []:
            if not case.get("benchmark_eligible"):
                continue
            review = dict(case.get("admin_review") or {})
            status = str(review.get("status") or "").lower()
            if status not in {"approved", "rejected"}:
                continue
            category = str(case.get("category") or "unknown")
            values = dict((case.get("benchmark_gate") or {}).get("metrics") or {})
            values.update(
                {
                    key: value
                    for key, value in dict((case.get("result_metadata") or {}).get("metadata") or {}).items()
                    if isinstance(value, (int, float)) and not isinstance(value, bool)
                }
            )
            for name, value in values.items():
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    observations[category][str(name)].append((float(value), status == "approved"))

    categories: dict[str, object] = {}
    for category, metric_values in sorted(observations.items()):
        metrics: dict[str, object] = {}
        for name, values in sorted(metric_values.items()):
            positives = [value for value, label in values if label]
            negatives = [value for value, label in values if not label]
            sufficient = len(positives) >= minimum_per_label and len(negatives) >= minimum_per_label
            proposal = _best_threshold(values) if sufficient else None
            metrics[name] = {
                "approved_examples": len(positives),
                "rejected_examples": len(negatives),
                "approved_mean": mean(positives) if positives else None,
                "rejected_mean": mean(negatives) if negatives else None,
                "sufficient_for_proposal": sufficient,
                "proposal": proposal,
            }
        categories[category] = {"metrics": metrics}
    return {
        "mode": "proposal_only",
        "thresholds_modified": False,
        "minimum_examples_per_label": minimum_per_label,
        "categories": categories,
    }


def _best_threshold(values: list[tuple[float, bool]]) -> dict[str, object]:
    unique = sorted({value for value, _ in values})
    candidates = unique + [(left + right) / 2.0 for left, right in zip(unique, unique[1:])]
    best: tuple[float, float, str] | None = None
    for direction in ("greater_or_equal", "less_or_equal"):
        for threshold in candidates:
            true_positive = sum(label and ((value >= threshold) if direction == "greater_or_equal" else (value <= threshold)) for value, label in values)
            true_negative = sum((not label) and ((value < threshold) if direction == "greater_or_equal" else (value > threshold)) for value, label in values)
            positives = sum(label for _, label in values)
            negatives = len(values) - positives
            balanced_accuracy = 0.5 * (true_positive / positives + true_negative / negatives)
            candidate = (balanced_accuracy, threshold, direction)
            if best is None or candidate > best:
                best = candidate
    assert best is not None
    return {"balanced_accuracy": best[0], "threshold": best[1], "direction": best[2]}
