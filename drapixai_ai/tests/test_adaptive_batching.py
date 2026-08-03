from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.engines.base import TryOnCandidate, TryOnEngine, TryOnResult
from drapixai_ai.engines.catvton import CatVTONEngine
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.worker import gpu_worker


class _FallbackEngine(TryOnEngine):
    name = "fallback"

    def load(self) -> None:
        return None

    def generate(
        self,
        person,
        garment,
        mask=None,
        *,
        inference_steps=None,
        guidance_scale=None,
        seed=None,
        garment_type=None,
    ):
        return person.copy()


class _MaskProcessor:
    @staticmethod
    def blur(mask, blur_factor):
        return mask


class _CapturingCatVTONPipeline:
    def __init__(self) -> None:
        self.batch_size = 0

    def __call__(self, *, image, condition_image, mask, **kwargs):
        self.batch_size = int(image.shape[0])
        assert int(condition_image.shape[0]) == self.batch_size
        assert int(mask.shape[0]) == self.batch_size
        return [
            Image.new("RGB", (kwargs["width"], kwargs["height"]), (40 + index, 80, 120))
            for index in range(self.batch_size)
        ]


class _BatchEngine(_FallbackEngine):
    name = "catvton"

    def generate_batch(
        self,
        persons,
        garments,
        masks=None,
        *,
        inference_steps=None,
        guidance_scale=None,
        seeds=None,
        garment_types=None,
    ):
        self.last_generation_masks = [
            Image.new("L", person.size, 255) for person in persons
        ]
        self.last_safety_blocked_flags = [False] * len(persons)
        return [person.copy() for person in persons]


class _Scorer:
    @staticmethod
    def choose_best(person, garment, candidates, garment_type=None):
        candidate = TryOnCandidate(
            image=candidates[0].image,
            seed=candidates[0].seed,
            score=0.97,
            warnings=list(candidates[0].warnings),
            metadata={"overall_realism": 0.97},
        )
        return candidate, [0.97], []


class _WorkerBatchPipeline:
    def __init__(self) -> None:
        self.batch_calls = 0
        self.single_calls = 0

    def run_tryon_batch_with_metadata(self, persons, cloths, **kwargs):
        self.batch_calls += 1
        return [
            TryOnResult(
                image=person.copy(),
                engine="catvton",
                quality_score=0.97,
                candidate_count=1,
                candidate_scores=[0.97],
                warnings=[],
                metadata={"timings": {}, "batch_index": index},
            )
            for index, person in enumerate(persons)
        ]

    def run_tryon_with_metadata(self, person, cloth, **kwargs):
        self.single_calls += 1
        return TryOnResult(
            image=person.copy(),
            engine="catvton",
            quality_score=0.97,
            candidate_count=1,
            candidate_scores=[0.97],
            warnings=[],
            metadata={"timings": {}},
        )


class AdaptiveBatchingTests(unittest.TestCase):
    def test_launch_batch_cap_is_three(self) -> None:
        self.assertGreaterEqual(settings.gpu_batch_max, 1)
        self.assertLessEqual(settings.gpu_batch_max, 3)

    def test_base_engine_has_isolated_sequential_fallback(self) -> None:
        engine = _FallbackEngine()
        persons = [
            Image.new("RGB", (8, 8), (index, 0, 0)) for index in range(3)
        ]
        outputs = engine.generate_batch(persons, persons)
        self.assertEqual(len(outputs), 3)
        self.assertEqual([image.getpixel((0, 0))[0] for image in outputs], [0, 1, 2])

    def test_catvton_receives_one_true_three_image_tensor_batch(self) -> None:
        engine = CatVTONEngine()
        engine.loaded = True
        engine.device = "cpu"
        engine.width = 8
        engine.height = 8
        engine.mask_processor = _MaskProcessor()
        engine.pipeline = _CapturingCatVTONPipeline()
        engine._build_mask = lambda person, garment_type: Image.new(  # type: ignore[method-assign]
            "L", person.size, 255
        )
        engine._preserve_untucked_hem = lambda mask, garment_type: mask  # type: ignore[method-assign]
        engine._preserve_long_sleeves = (  # type: ignore[method-assign]
            lambda mask, garment, garment_type: mask
        )
        images = [Image.new("RGB", (8, 8), (30, 60, 90)) for _ in range(3)]

        outputs = engine.generate_batch(images, images)

        self.assertEqual(engine.pipeline.batch_size, 3)
        self.assertEqual(len(outputs), 3)
        self.assertEqual(len(engine.last_generation_masks), 3)
        self.assertEqual(engine.last_safety_blocked_flags, [False, False, False])

    def test_pipeline_keeps_standard_metadata_isolated_per_output(self) -> None:
        pipeline = DrapixAITryOnPipeline.__new__(DrapixAITryOnPipeline)
        pipeline.engine = _BatchEngine()
        pipeline.scorer = _Scorer()
        images = [Image.new("RGB", (32, 48), (30, 60, 90)) for _ in range(3)]
        person_analysis = SimpleNamespace(
            width=32,
            height=48,
            validation_warnings=[],
        )
        garment_analysis = SimpleNamespace(
            width=32,
            height=48,
            warnings=[],
            foreground_ratio=0.5,
            bbox_ratio=0.5,
            background_ratio=0.5,
            dominant_color=(30, 60, 90),
        )

        with (
            patch(
                "drapixai_ai.pipeline.tryon_pipeline.analyze_person",
                return_value=person_analysis,
            ),
            patch(
                "drapixai_ai.pipeline.tryon_pipeline.analyze_garment",
                return_value=garment_analysis,
            ),
            patch(
                "drapixai_ai.pipeline.tryon_pipeline.apply_quality_boosters",
                side_effect=lambda image, **kwargs: image,
            ),
        ):
            results = pipeline.run_tryon_batch_with_metadata(
                images,
                images,
                garment_types=["upper", "upper", "upper"],
                qualities=["standard", "standard", "standard"],
            )

        self.assertEqual(len(results), 3)
        for index, result in enumerate(results):
            self.assertEqual(result.candidate_count, 1)
            self.assertEqual(result.metadata["quality_mode"], "standard")
            self.assertEqual(result.metadata["batch_size"], 3)
            self.assertEqual(result.metadata["batch_index"], index)
            self.assertTrue(result.metadata["true_gpu_batch"])
            self.assertEqual(result.quality_score, 0.97)

    def test_worker_serializes_three_independent_results_from_one_batch(self) -> None:
        pipeline = _WorkerBatchPipeline()
        payloads = [
            {
                "user_id": f"user-{index}",
                "person_image_ref": f"person-{index}",
                "cloth_image_ref": f"cloth-{index}",
                "quality": "standard",
                "garment_type": "upper",
            }
            for index in range(3)
        ]
        image = Image.new("RGB", (32, 48), (30, 60, 90))

        def decode(payload):
            payload["_decode_ms"] = 1
            return image.copy(), image.copy()

        with (
            patch.object(gpu_worker, "_get_pipeline", return_value=pipeline),
            patch.object(gpu_worker, "_decode_payload", side_effect=decode),
            patch.object(gpu_worker, "_finalize_output_image", side_effect=lambda value: value),
            patch.object(
                gpu_worker,
                "_store_output_image",
                side_effect=["result-0", "result-1", "result-2"],
            ),
            patch.object(gpu_worker, "_gpu_memory_metrics", return_value={}),
            patch.object(gpu_worker, "cleanup_expired_transients"),
        ):
            results = gpu_worker._run_tryon_payload_batch(payloads)

        self.assertEqual(pipeline.batch_calls, 1)
        self.assertEqual(len(results), 3)
        for index, result in enumerate(results):
            self.assertIsInstance(result, dict)
            self.assertEqual(result["output_image_ref"], f"result-{index}")  # type: ignore[index]
            self.assertEqual(result["candidate_count"], 1)  # type: ignore[index]
            self.assertEqual(result["timings"]["worker_batch_size"], 3)  # type: ignore[index]

    def test_worker_preserves_approved_single_image_pipeline(self) -> None:
        pipeline = _WorkerBatchPipeline()
        payload = {
            "user_id": "single-user",
            "person_image_ref": "person",
            "cloth_image_ref": "cloth",
            "quality": "standard",
            "garment_type": "upper",
        }
        image = Image.new("RGB", (32, 48), (30, 60, 90))

        def decode(value):
            value["_decode_ms"] = 1
            return image.copy(), image.copy()

        with (
            patch.object(gpu_worker, "_get_pipeline", return_value=pipeline),
            patch.object(gpu_worker, "_decode_payload", side_effect=decode),
            patch.object(gpu_worker, "_finalize_output_image", side_effect=lambda value: value),
            patch.object(gpu_worker, "_store_output_image", return_value="result"),
            patch.object(gpu_worker, "_gpu_memory_metrics", return_value={}),
            patch.object(gpu_worker, "cleanup_expired_transients"),
        ):
            result = gpu_worker._run_tryon_payload_batch([payload])[0]

        self.assertIsInstance(result, dict)
        self.assertEqual(pipeline.single_calls, 1)
        self.assertEqual(pipeline.batch_calls, 0)
        self.assertEqual(result["timings"]["worker_batch_size"], 1)  # type: ignore[index]


if __name__ == "__main__":
    unittest.main()
