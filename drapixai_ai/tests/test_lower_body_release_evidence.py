from __future__ import annotations

import unittest

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_release import (
    RATING_FIELDS,
    REQUIRED_APPROVALS,
    apply_admin_reviews,
    calibrate_metrics,
    evaluate_release_evidence,
)


def _summary(run_id: str = "run-01", seed: int = 42) -> dict[str, object]:
    cases = []
    categories = {}
    for category in LOWER_BODY_CATEGORIES:
        slug = f"{category}-001"
        cases.append(
            {
                "slug": slug,
                "category": category,
                "benchmark_eligible": True,
                "benchmark_gate": {
                    "passed_automated": True,
                    "metrics": {"shape": 0.92, "texture": 0.91},
                },
                "result_metadata": {
                    "metadata": {"experimental_layered_garment_score": 0.90}
                },
            }
        )
        categories[category] = {
            "eligible_cases": 1,
            "minimum_cases": 1,
            "automated_pass_rate": 1.0,
        }
    return {
        "run_id": run_id,
        "engine": "fashn_vton_1_5",
        "seed": seed,
        "matrix_sha256": "abc123",
        "benchmark_version": "lower-real-v1",
        "minimum_cases_per_category": 1,
        "minimum_category_pass_rate": 0.90,
        "minimum_admin_pass_rate": 0.95,
        "failed": 0,
        "latency_p95_ms": 24_000,
        "category_summary": categories,
        "cases": cases,
    }


def _reviews(summary: dict[str, object]) -> dict[str, object]:
    return {
        "run_id": summary["run_id"],
        "engine": summary["engine"],
        "reviews": {
            str(case["slug"]): {
                "status": "approved",
                "reviewer": "reviewer-01",
                **{field: 5 for field in RATING_FIELDS},
                "severe_failures": [],
            }
            for case in summary["cases"]
        },
    }


def _approvals() -> dict[str, object]:
    return {
        "approvals": {
            area: {
                "status": "approved",
                "approver": "owner-01",
                "evidence_ref": f"evidence/{area}",
            }
            for area in REQUIRED_APPROVALS
        }
    }


class LowerBodyReleaseEvidenceTests(unittest.TestCase):
    def test_admin_reviews_require_exact_run_engine_and_case_set(self) -> None:
        summary = _summary()
        reviews = _reviews(summary)
        reviews["run_id"] = "wrong-run"
        reviews["reviews"].pop("jeans-001")
        reviews["reviews"]["unknown-001"] = {
            "status": "approved",
            "reviewer": "reviewer-01",
            **{field: 5 for field in RATING_FIELDS},
            "severe_failures": [],
        }

        reviewed, errors = apply_admin_reviews(summary, reviews)

        self.assertIn("REVIEW_RUN_ID_MISMATCH", errors)
        self.assertIn("jeans-001:REVIEW_MISSING", errors)
        self.assertIn("unknown-001:UNEXPECTED_REVIEW", errors)
        self.assertFalse(reviewed["admin_review"]["complete"])
        self.assertFalse(reviewed["eligible_for_release_evaluation"])

    def test_two_matching_reviewed_runs_become_manually_eligible(self) -> None:
        reviewed_runs = []
        for seed, run_id in enumerate(("run-01", "run-02"), start=42):
            source = _summary(run_id, seed)
            reviewed, errors = apply_admin_reviews(source, _reviews(source))
            self.assertEqual(errors, [])
            reviewed_runs.append(reviewed)

        decision = evaluate_release_evidence(
            {
                "valid": True,
                "manifest_sha256": "abc123",
                "benchmark_version": "lower-real-v1",
            },
            reviewed_runs,
            release_approvals=_approvals(),
        )

        self.assertEqual(decision["decision"], "eligible_for_manual_public_enable")
        self.assertFalse(decision["public_feature_flag_changed"])
        self.assertEqual(decision["blockers"], [])

    def test_release_is_blocked_by_latency_or_severe_failure(self) -> None:
        reviewed_runs = []
        for seed, run_id in enumerate(("run-01", "run-02"), start=42):
            source = _summary(run_id, seed)
            reviews = _reviews(source)
            if run_id == "run-02":
                reviews["reviews"]["pants-001"]["status"] = "rejected"
                reviews["reviews"]["pants-001"]["severe_failures"] = ["background_corruption"]
            reviewed, _ = apply_admin_reviews(source, reviews)
            if run_id == "run-01":
                reviewed["latency_p95_ms"] = 40_000
            reviewed_runs.append(reviewed)

        decision = evaluate_release_evidence(
            {
                "valid": True,
                "manifest_sha256": "abc123",
                "benchmark_version": "lower-real-v1",
            },
            reviewed_runs,
            release_approvals=_approvals(),
        )

        self.assertEqual(decision["decision"], "blocked")
        self.assertTrue(any("LATENCY_P95_EXCEEDED" in value for value in decision["blockers"]))
        self.assertTrue(any("SEVERE_FAILURES_PRESENT" in value for value in decision["blockers"]))

    def test_calibration_only_proposes_when_both_labels_are_present(self) -> None:
        summary = _summary()
        cases = summary["cases"]
        cases[0]["admin_review"] = {"status": "approved"}
        cases[1]["category"] = cases[0]["category"]
        cases[1]["admin_review"] = {"status": "rejected"}
        cases[1]["benchmark_gate"]["metrics"]["shape"] = 0.35

        report = calibrate_metrics([summary], minimum_per_label=1)
        shape = report["categories"][cases[0]["category"]]["metrics"]["shape"]

        self.assertTrue(shape["sufficient_for_proposal"])
        self.assertEqual(shape["proposal"]["direction"], "greater_or_equal")
        self.assertFalse(report["thresholds_modified"])


if __name__ == "__main__":
    unittest.main()
