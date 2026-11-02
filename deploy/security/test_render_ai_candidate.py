"""Prevent a review image from asserting the old vulnerable dependency pins."""
from __future__ import annotations

from pathlib import Path
import unittest

from render_ai_candidate import render, VERSIONS


class CandidateDockerfileTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2]
        self.source = (root / "drapixai_ai/docker/Dockerfile").read_bytes()
        self.requirements = (root / "drapixai_ai/requirements.rtx-pro-6000.security-candidate.txt").read_text(encoding="utf-8")

    def test_only_exact_dependency_assertions_change(self):
        candidate = render(self.source, self.requirements)
        self.assertNotEqual(candidate, self.source)
        restored = candidate
        for name, (old, new) in VERSIONS.items():
            restored = restored.replace(f"    '{name}': '{new}',".encode(),
                                        f"    '{name}': '{old}',".encode())
        self.assertEqual(restored, self.source)

    def test_rejects_unexpected_source_and_unsafe_candidate_pins(self):
        for name, (old, new) in VERSIONS.items():
            with self.subTest(name=name, boundary="serving-source"):
                source = self.source.replace(f"'{name}': '{old}'".encode(),
                                             f"'{name}': 'unexpected'".encode())
                with self.assertRaisesRegex(ValueError, "SERVING_ASSERTION_CHANGED"):
                    render(source, self.requirements)
            with self.subTest(name=name, boundary="candidate-pin"):
                requirements = self.requirements.replace(f"{name}=={new}", f"{name}=={old}")
                with self.assertRaisesRegex(ValueError, "CANDIDATE_PIN_MISMATCH"):
                    render(self.source, requirements)

    def test_rejects_duplicate_pins(self):
        with self.assertRaisesRegex(ValueError, "DUPLICATE_CANDIDATE_PIN"):
            render(self.source, self.requirements + "\npillow==13.0.0\n")


if __name__ == "__main__":
    unittest.main()
