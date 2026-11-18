from __future__ import annotations

import unittest
from copy import deepcopy
from dataclasses import asdict

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_benchmark import LOWER_BODY_BENCHMARK_THRESHOLDS
from drapixai_ai.tests.lower_body_evidence_fixtures import run_context
from drapixai_ai.services.lower_body_artifacts import canonical_sha256
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
    context = run_context()
    context_sha = canonical_sha256(context)
    for category in LOWER_BODY_CATEGORIES:
        for index in range(1, 13):
            slug = f"{category}-{index:03d}"
            cases.append(
                {
                    "slug": slug,
                    "category": category,
                    "status": "succeeded",
                    "benchmark_eligible": True,
                    "run_context_sha256": context_sha,
                    "preprocess": {"mode": "strict"},
                    "settings": {"allow_bypass_validation": False},
                    "person_validation": {
                        "ok": True, "pose_checked": True,
                        "person_count": 1, "pose_backend": "dwpose_onnx_cpu",
                    },
                    "benchmark_gate": {
                        "passed_automated": True,
                        "metrics": {
                            **{name: 0.99 for name in asdict(LOWER_BODY_BENCHMARK_THRESHOLDS[category])},
                            "overall": 0.95,
                        },
                    },
                    "result_metadata": {
                        "quality_score": 0.95,
                        "warnings": [],
                        "metadata": {"experimental_layered_garment_score": 0.90},
                    },
                }
            )
        categories[category] = {
            "eligible_cases": 12,
            "minimum_cases": 12,
            "automated_pass_rate": 1.0,
        }
    return {
        "run_context": context,
        "run_context_sha256": context_sha,
        "run_id": run_id,
        "engine": "fashn_vton_1_5",
        "seed": seed,
        "matrix_sha256": "abc123",
        "benchmark_version": "lower-real-v1",
        "minimum_cases_per_category": 12,
        "minimum_category_pass_rate": 0.90,
        "minimum_admin_pass_rate": 0.95,
        "failed": 0,
        "latency_p95_ms": 24_000,
        "category_summary": categories,
        "cases": cases,
    }


def _intake() -> dict[str, object]:
    return {
        "valid": True,
        "manifest_sha256": "abc123",
        "benchmark_version": "lower-real-v1",
        "eligible_case_ids": [
            {"slug": case["slug"], "category": case["category"]}
            for case in _summary()["cases"]
        ],
    }


def _reviewed_runs() -> list[dict[str, object]]:
    runs = []
    for seed, run_id in enumerate(("run-01", "run-02"), start=42):
        source = _summary(run_id, seed)
        reviewed, errors = apply_admin_reviews(source, _reviews(source))
        if errors:
            raise AssertionError(errors)
        runs.append(reviewed)
    return runs


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
            _intake(),
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
            _intake(),
            reviewed_runs,
            release_approvals=_approvals(),
        )

        self.assertEqual(decision["decision"], "blocked")
        self.assertTrue(any("LATENCY_P95_EXCEEDED" in value for value in decision["blockers"]))
        self.assertTrue(any("SEVERE_FAILURES_PRESENT" in value for value in decision["blockers"]))

    def test_forged_pass_labels_cannot_hide_low_or_invalid_scores(self) -> None:
        baseline = _reviewed_runs()
        for score in (0.949999, None, True, "0.99", float("nan"), float("inf"), 1.01, -1):
            with self.subTest(score=score):
                runs = deepcopy(baseline)
                runs[0]["cases"][0]["result_metadata"]["quality_score"] = score
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertEqual(decision["decision"], "blocked")
                self.assertIn("run-01:jeans:COMBINED_RATE_FAILED", decision["blockers"])
                self.assertAlmostEqual(decision["runs"][0]["measured_categories"]["jeans"]["release_pass_rate"], 11 / 12)

    def test_category_metrics_are_rechecked_against_current_thresholds(self) -> None:
        for field, value in (("texture", 0.2), ("context", float("nan")), ("hem", 1.1), ("shape", None)):
            with self.subTest(field=field):
                runs = _reviewed_runs()
                runs[0]["cases"][0]["benchmark_gate"]["metrics"][field] = value
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertEqual(decision["decision"], "blocked")

    def test_warnings_and_intake_bypass_cannot_be_approved(self) -> None:
        for change in ("warning", "missing_warnings", "bypass", "preprocess"):
            with self.subTest(change=change):
                runs = _reviewed_runs()
                case = runs[0]["cases"][0]
                if change == "warning":
                    case["result_metadata"]["warnings"] = ["LOWER_GARMENT_TEXTURE_DRIFT"]
                elif change == "missing_warnings":
                    case["result_metadata"].pop("warnings")
                elif change == "bypass":
                    case["settings"]["allow_bypass_validation"] = True
                else:
                    case["preprocess"]["mode"] = "bypass_validation"
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertEqual(decision["decision"], "blocked")

    def test_informational_lower_body_labels_are_not_visual_failures(self) -> None:
        runs = _reviewed_runs()
        runs[0]["cases"][0]["result_metadata"]["warnings"] = [
            "LOWER_BODY_V1_REVIEW_REQUIRED", "LOWER_BODY_PROFILE:JEANS",
        ]
        decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
        self.assertEqual(decision["decision"], "eligible_for_manual_public_enable")

    def test_unchecked_or_multi_person_pose_evidence_blocks_release(self) -> None:
        for change in ({}, {"ok": True}, {"ok": True, "pose_checked": False}, {
            "ok": True, "pose_checked": True, "person_count": 2, "pose_backend": "dwpose_onnx_cpu",
        }):
            with self.subTest(change=change):
                runs = _reviewed_runs()
                runs[0]["cases"][0]["person_validation"] = change
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertEqual(decision["decision"], "blocked")

    def test_case_count_cannot_be_lowered_by_report_configuration(self) -> None:
        runs = _reviewed_runs()
        runs[0]["cases"] = runs[0]["cases"][1:]
        runs[0]["minimum_cases_per_category"] = 1
        runs[0]["category_summary"]["jeans"]["minimum_cases"] = 1
        decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
        self.assertIn("run-01:jeans:INSUFFICIENT_CASES", decision["blockers"])
        self.assertIn("run-01:BENCHMARK_CASE_SET_MISMATCH", decision["blockers"])

    def test_duplicate_cases_and_run_ids_fail(self) -> None:
        runs = _reviewed_runs()
        runs[0]["cases"][1] = deepcopy(runs[0]["cases"][0])
        runs[1]["run_id"] = runs[0]["run_id"]
        decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
        self.assertIn("run-01:DUPLICATE_CASE_SLUG", decision["blockers"])
        self.assertIn("RUN_IDS_NOT_DISTINCT", decision["blockers"])

    def test_changed_model_settings_or_image_cannot_share_a_release_decision(self) -> None:
        for change in ("settings", "image", "source", "parser"):
            with self.subTest(change=change):
                runs = _reviewed_runs()
                context = runs[1]["run_context"]
                if change == "settings":
                    context["settings"]["fashn_num_timesteps"] = 30
                elif change == "image":
                    context["image"] = "unit-test.invalid/lower@sha256:" + "d" * 64
                elif change == "source":
                    context["source_files"]["drapixai_ai/pipeline/unit_only.py"] = "d" * 64
                else:
                    context["model_identity"]["human_parser"]["revision"] = "d" * 40
                runs[1]["run_context_sha256"] = canonical_sha256(context)
                for case in runs[1]["cases"]:
                    case["run_context_sha256"] = runs[1]["run_context_sha256"]
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertEqual(decision["decision"], "blocked")
                self.assertIn("RUN_CONTEXT_MISMATCH", decision["blockers"])

    def test_missing_or_tampered_run_context_fails(self) -> None:
        for key in ("run_context", "run_context_sha256"):
            with self.subTest(key=key):
                runs = _reviewed_runs()
                runs[0].pop(key)
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertIn("run-01:RUN_CONTEXT_INVALID", decision["blockers"])

    def test_non_finite_latency_is_never_eligible(self) -> None:
        for latency in (float("nan"), float("inf"), -1, 0, True, None):
            with self.subTest(latency=latency):
                runs = _reviewed_runs()
                runs[0]["latency_p95_ms"] = latency
                decision = evaluate_release_evidence(_intake(), runs, release_approvals=_approvals())
                self.assertIn("run-01:LATENCY_P95_MISSING", decision["blockers"])

    def test_cannot_reduce_two_run_or_admin_rate_policy(self) -> None:
        with self.assertRaisesRegex(ValueError, "TWO_RELEASE_RUNS"):
            evaluate_release_evidence(_intake(), _reviewed_runs(), required_runs=1)
        with self.assertRaisesRegex(ValueError, "ADMIN_RATE_BELOW_POLICY"):
            source = _summary()
            apply_admin_reviews(source, _reviews(source), minimum_admin_rate=0.1)

    def test_missing_reviewer_cannot_count_as_approved(self) -> None:
        source = _summary()
        reviews = _reviews(source)
        reviews["reviews"]["jeans-001"]["reviewer"] = ""
        reviewed, errors = apply_admin_reviews(source, reviews)
        self.assertIn("jeans-001:REVIEWER_REQUIRED", errors)
        self.assertFalse(reviewed["cases"][0]["admin_review"]["approved"])

    def test_intake_must_provide_exact_case_identities(self) -> None:
        intake = _intake()
        intake.pop("eligible_case_ids")
        decision = evaluate_release_evidence(intake, _reviewed_runs(), release_approvals=_approvals())
        self.assertIn("BENCHMARK_CASE_IDENTITIES_INVALID", decision["blockers"])

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
