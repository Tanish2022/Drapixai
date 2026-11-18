from __future__ import annotations

import unittest

from PIL import Image

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_benchmark import evaluate_lower_body_benchmark_case


class LowerBodyBenchmarkPolicyTests(unittest.TestCase):
    def _evaluate(self, score: object = 0.95, category: str = "jeans", **changes):
        image = Image.new("RGB", (128, 192), "white")
        metrics = {
            "waistband_alignment": 1.0,
            "crotch_artifact_score": 1.0,
            "knee_preservation": 1.0,
            "hem_alignment": 1.0,
            "ankle_preservation": 1.0,
            "shoe_preservation": 1.0,
            "left_leg_integrity": 1.0,
            "right_leg_integrity": 1.0,
            "lower_garment_coverage": 1.0,
            "edge_quality": 1.0,
            "lower_garment_texture_similarity": 1.0,
            "lower_garment_color_similarity": 1.0,
            "face_preservation": 1.0,
            "upper_body_preservation": 1.0,
            "background_cast_score": 1.0,
            # Metadata dimensions and category codes are not unit-range scores.
            "person_width": 1024,
            "lower_body_category_profile": 7,
        }
        metrics.update(changes.pop("metrics", {}))
        return evaluate_lower_body_benchmark_case(
            image, image, category=category, quality_score=score,
            metrics=metrics, **changes,
        )

    def test_every_category_requires_at_least_nine_point_five(self) -> None:
        for category in LOWER_BODY_CATEGORIES:
            with self.subTest(category=category):
                self.assertFalse(self._evaluate(0.949999, category)["passed_automated"])
                self.assertTrue(self._evaluate(0.95, category)["passed_automated"])

    def test_missing_non_finite_and_out_of_range_scores_fail(self) -> None:
        for value in (None, True, "0.99", float("nan"), float("inf"), -1, 1.01):
            with self.subTest(value=value):
                report = self._evaluate(value)
                self.assertFalse(report["passed_automated"])
                self.assertIn("overall", report["failed_metrics"])

    def test_invalid_component_cannot_hide_in_minimum_or_preserved_region(self) -> None:
        for name in ("face_preservation", "knee_preservation", "lower_garment_texture_similarity"):
            for value in (float("nan"), float("inf"), True, None, "1.0", 1.1):
                with self.subTest(name=name, value=value):
                    report = self._evaluate(metrics={name: value})
                    self.assertFalse(report["passed_automated"])
                    self.assertIn(name, report["invalid_metrics"])

    def test_visual_warning_blocks_even_with_a_perfect_score(self) -> None:
        report = self._evaluate(1.0, warnings=["LOWER_GARMENT_TEXTURE_DRIFT"])
        self.assertFalse(report["passed_automated"])
        self.assertEqual(report["blocking_warnings"], ["LOWER_GARMENT_TEXTURE_DRIFT"])

    def test_beta_profile_labels_do_not_mask_or_create_visual_failures(self) -> None:
        warnings = ["LOWER_BODY_V1_REVIEW_REQUIRED", "LOWER_BODY_PROFILE:JEANS"]
        self.assertTrue(self._evaluate(warnings=warnings)["passed_automated"])
        self.assertFalse(self._evaluate(warnings=[*warnings, "UNKNOWN_WARNING"])["passed_automated"])


if __name__ == "__main__":
    unittest.main()
