from __future__ import annotations

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from deploy.runpod import validate_lower_body_benchmark as validator
from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES
from drapixai_ai.quality.lower_body_benchmark import CATEGORY_STAGE, STAGE_ORDER


class LowerBodyBenchmarkIntakeTests(unittest.TestCase):
    def _validate(self, count: int, requested_minimum: int = 12, eligibility: object = True):
        with tempfile.TemporaryDirectory(prefix="lower-intake-policy-") as directory:
            root = Path(directory)
            # Contrived bytes test provenance bookkeeping only, not photo quality.
            asset = root / "unit-test-only.bin"
            asset.write_bytes(b"synthetic unit test evidence - never a real benchmark")
            digest = hashlib.sha256(asset.read_bytes()).hexdigest()
            cases = []
            ordered_categories = sorted(LOWER_BODY_CATEGORIES, key=lambda category: STAGE_ORDER[CATEGORY_STAGE[category]])
            for category in ordered_categories:
                for index in range(count):
                    cases.append({
                        "slug": f"{category}-{index:03d}",
                        "category": category,
                        "benchmark_eligible": eligibility,
                        "person_path": str(asset),
                        "garment_path": str(asset),
                        "attributes": {name: f"unit-test-{index % 2}" for name in validator.REQUIRED_ATTRIBUTES},
                        "provenance": {
                            role: {
                                "source_id": "unit-test-only",
                                "rights": "owned",
                                "consent": "confirmed",
                                "synthetic": False,
                                "sha256": digest,
                            }
                            for role in ("person", "garment")
                        },
                    })
            manifest_path = root / "manifest.json"
            report_path = root / "report.json"
            manifest_path.write_text(json.dumps({
                "benchmark_version": "unit-test-only",
                "targets": {"minimum_cases_per_category": requested_minimum},
                "cases": cases,
            }), encoding="utf-8")
            with (
                patch.object(validator, "APP_ROOT", root),
                patch.object(validator, "MANIFEST_PATH", manifest_path),
                patch.object(validator, "REPORT_PATH", report_path),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                exit_code = validator.main()
            return exit_code, json.loads(report_path.read_text(encoding="utf-8"))

    def test_manifest_cannot_reduce_minimum_sample_count(self) -> None:
        exit_code, report = self._validate(2, requested_minimum=1)
        self.assertEqual(exit_code, 1)
        self.assertFalse(report["valid"])
        self.assertTrue(all(category["minimum_cases"] == 12 for category in report["categories"].values()))

    def test_eligible_intake_records_exact_case_set(self) -> None:
        exit_code, report = self._validate(12)
        self.assertEqual(exit_code, 0)
        self.assertEqual(report["eligible_case_count"], 84)
        self.assertEqual(len(report["eligible_case_ids"]), 84)
        self.assertEqual(len({case["slug"] for case in report["eligible_case_ids"]}), 84)

    def test_string_true_cannot_assert_eligibility(self) -> None:
        exit_code, report = self._validate(12, eligibility="true")
        self.assertEqual(exit_code, 1)
        self.assertEqual(report["eligible_case_count"], 0)
        self.assertEqual(report["eligible_case_ids"], [])


if __name__ == "__main__":
    unittest.main()
