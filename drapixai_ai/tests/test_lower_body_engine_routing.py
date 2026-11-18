from __future__ import annotations

import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from PIL import Image

from drapixai_ai.engines.fashn_vton import FashnVTONEngine
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.services.tryon_service import TryOnService
from drapixai_ai.worker.gpu_worker import AdaptiveBatchWorker
from drapixai_ai.services.lower_body_validator import LowerBodyValidation


class _Engine:
    def __init__(self, name: str) -> None:
        self.name = name
        self.load_calls = 0

    def load(self) -> None:
        self.load_calls += 1


class LowerBodyEngineRoutingTests(unittest.TestCase):
    def test_fashn_adapter_is_lower_body_only_and_lazy(self) -> None:
        calls: list[dict[str, object]] = []

        class FakePipeline:
            def __init__(self, **kwargs) -> None:
                calls.append({"load": kwargs})

            def __call__(self, **kwargs):
                calls.append({"run": kwargs})
                return SimpleNamespace(images=[kwargs["person_image"].copy()])

        fake_module = types.ModuleType("fashn_vton")
        fake_module.TryOnPipeline = FakePipeline  # type: ignore[attr-defined]
        engine = FashnVTONEngine()
        image = Image.new("RGB", (32, 48), (40, 80, 120))

        with (
            patch.dict(sys.modules, {"fashn_vton": fake_module}),
            patch("drapixai_ai.engines.fashn_vton.verify_lower_body_artifacts", return_value={"identity_sha256": "unit-test"}),
        ):
            with self.assertRaisesRegex(ValueError, "LOWER_BODY_ONLY"):
                engine.generate(image, image, garment_type="upper")
            self.assertFalse(engine.loaded)
            output = engine.generate(image, image, garment_type="lower:jeans")

        self.assertTrue(engine.loaded)
        self.assertEqual(output.size, image.size)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["run"]["category"], "bottoms")  # type: ignore[index]
        self.assertEqual(calls[1]["run"]["num_timesteps"], 50)  # type: ignore[index]
        self.assertEqual(calls[1]["run"]["guidance_scale"], 1.5)  # type: ignore[index]

    def test_fashn_parser_uses_verified_local_model_directory(self) -> None:
        class FakePipeline:
            def __init__(self, **kwargs):
                self.device = kwargs["device"]
                self._setup_hp_model()

        fake_module = types.ModuleType("fashn_vton")
        fake_module.TryOnPipeline = FakePipeline
        parser_module = types.ModuleType("fashn_human_parser")
        parser_module.FashnHumanParser = Mock()
        engine = FashnVTONEngine(weights_dir="runtime/unit-test-only-weights", device="cpu")
        with (
            patch.dict(sys.modules, {"fashn_vton": fake_module, "fashn_human_parser": parser_module}),
            patch("drapixai_ai.engines.fashn_vton.verify_lower_body_artifacts", return_value={"identity_sha256": "unit-test"}) as verify,
        ):
            engine.load()
        from pathlib import Path

        verify.assert_called_once_with(Path("runtime/unit-test-only-weights"))
        parser_module.FashnHumanParser.assert_called_once_with(
            model_id=str(Path("runtime/unit-test-only-weights").resolve() / "human_parser"), device="cpu",
        )

    def test_fashn_postprocessing_is_an_explicit_ab_switch(self) -> None:
        engine = _Engine("fashn_vton_1_5")
        fake_settings = SimpleNamespace(fashn_enable_postprocess=False)
        with patch("drapixai_ai.pipeline.tryon_pipeline.settings", fake_settings):
            self.assertFalse(
                DrapixAITryOnPipeline._should_postprocess(engine, "lower:jeans")
            )
            self.assertTrue(
                DrapixAITryOnPipeline._should_postprocess(engine, "upper")
            )

    def test_pipeline_keeps_upper_engine_and_lazily_builds_lower_engine(self) -> None:
        pipeline = DrapixAITryOnPipeline.__new__(DrapixAITryOnPipeline)
        pipeline.engine = _Engine("catvton")  # type: ignore[assignment]
        pipeline.lower_engine = None
        lower = _Engine("fashn_vton_1_5")
        fake_settings = SimpleNamespace(
            enable_lower_body=True,
            lower_body_engine="fashn_vton",
            tryon_engine="catvton",
        )

        with (
            patch("drapixai_ai.pipeline.tryon_pipeline.settings", fake_settings),
            patch.object(pipeline, "_build_engine", return_value=lower) as build,
        ):
            self.assertIs(pipeline._engine_for("upper"), pipeline.engine)
            self.assertIs(pipeline._engine_for("lower:shorts"), lower)
            self.assertIs(pipeline._engine_for("lower:skirt"), lower)

        build.assert_called_once_with("fashn_vton")

    def test_tryon_service_routes_lower_categories_to_dedicated_queue(self) -> None:
        self.assertFalse(TryOnService._is_lower_body("upper"))
        self.assertTrue(TryOnService._is_lower_body("lower"))
        self.assertTrue(TryOnService._is_lower_body("lower:leggings"))

    def test_adaptive_batch_key_separates_upper_and_lower(self) -> None:
        upper = AdaptiveBatchWorker._compatibility_key(
            {"garment_type": "upper", "quality": "standard"}
        )
        lower = AdaptiveBatchWorker._compatibility_key(
            {"garment_type": "lower:jeans", "quality": "standard"}
        )
        self.assertNotEqual(upper, lower)

    def test_upper_body_never_initializes_lower_body_pose(self) -> None:
        with patch("drapixai_ai.pipeline.tryon_pipeline.validate_lower_body_person") as validate:
            result = DrapixAITryOnPipeline._validate_lower_person(Image.new("RGB", (32, 48)), "upper")
        self.assertIsNone(result)
        validate.assert_not_called()

    def test_lower_body_validation_requires_server_enable(self) -> None:
        with (
            patch("drapixai_ai.pipeline.tryon_pipeline.settings", SimpleNamespace(enable_lower_body=False)),
            patch("drapixai_ai.pipeline.tryon_pipeline.validate_lower_body_person") as validate,
        ):
            with self.assertRaisesRegex(RuntimeError, "LOWER_BODY_NOT_ENABLED"):
                DrapixAITryOnPipeline._validate_lower_person(Image.new("RGB", (32, 48)), "lower:jeans")
        validate.assert_not_called()

    def test_single_lower_input_is_rejected_before_diffusion(self) -> None:
        pipeline = DrapixAITryOnPipeline.__new__(DrapixAITryOnPipeline)
        engine = Mock()
        image = Image.new("RGB", (32, 48))
        with (
            patch("drapixai_ai.pipeline.tryon_pipeline.settings", SimpleNamespace(enable_lower_body=True, garment_condition_max_edge=1536)),
            patch.object(pipeline, "_engine_for", return_value=engine),
            patch("drapixai_ai.pipeline.tryon_pipeline.validate_lower_body_person", return_value=LowerBodyValidation(False, "MULTI_PERSON_UNSUPPORTED")),
        ):
            with self.assertRaisesRegex(ValueError, "MULTI_PERSON_UNSUPPORTED"):
                pipeline.run_tryon_with_metadata(image, image, garment_type="lower:jeans")
        engine.generate.assert_not_called()

    def test_batched_lower_input_is_rejected_before_diffusion(self) -> None:
        pipeline = DrapixAITryOnPipeline.__new__(DrapixAITryOnPipeline)
        image = Image.new("RGB", (32, 48))
        with (
            patch("drapixai_ai.pipeline.tryon_pipeline.settings", SimpleNamespace(enable_lower_body=True, garment_condition_max_edge=1536)),
            patch.object(pipeline, "_engine_for") as build,
            patch("drapixai_ai.pipeline.tryon_pipeline.validate_lower_body_person", return_value=LowerBodyValidation(False, "CROSSED_LEGS_UNSUPPORTED")),
        ):
            with self.assertRaisesRegex(ValueError, "CROSSED_LEGS_UNSUPPORTED"):
                pipeline.run_tryon_batch_with_metadata([image], [image], garment_types=["lower:jeans"])
        build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
