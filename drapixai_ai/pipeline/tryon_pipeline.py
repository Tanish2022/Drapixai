from __future__ import annotations

import io
import time
from typing import Iterable, List

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.engines.base import TryOnCandidate, TryOnEngine, TryOnResult
from drapixai_ai.postprocess.quality_boosters import apply_quality_boosters
from drapixai_ai.preprocess.garment_analyzer import analyze_garment
from drapixai_ai.preprocess.person_analyzer import analyze_person
from drapixai_ai.quality.tryon_scorer import TryOnScorer


class DrapixAITryOnPipeline:
    def __init__(self) -> None:
        self.engine = self._build_engine(settings.tryon_engine)
        self.scorer = TryOnScorer()

    @staticmethod
    def _to_pil(image_bytes: bytes) -> Image.Image:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return img

    @staticmethod
    def _build_engine(engine_name: str) -> TryOnEngine:
        normalized = engine_name.strip().lower().replace("-", "_")
        if normalized in {"catvton", "cat_vton"}:
            from drapixai_ai.engines.catvton import CatVTONEngine

            return CatVTONEngine()
        raise ValueError(f"Unsupported try-on engine: {engine_name}")

    def run_tryon(
        self,
        person: Image.Image,
        cloth: Image.Image,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        garment_type: str | None = None,
        quality: str | None = None,
    ) -> Image.Image:
        return self.run_tryon_with_metadata(
            person,
            cloth,
            inference_steps=inference_steps,
            guidance_scale=guidance_scale,
            garment_type=garment_type,
            quality=quality,
        ).image

    @staticmethod
    def _normalize_quality(quality: str | None) -> str:
        return "standard"

    @staticmethod
    def _parse_garment_type(value: str | None) -> tuple[str, str | None]:
        normalized = (value or "upper").strip().lower().replace("-", "_")
        category = None
        if ":" in normalized:
            garment_type, category = normalized.split(":", 1)
        else:
            garment_type = normalized
            if garment_type in {"jeans", "pants", "trousers", "shorts", "skirt", "leggings", "joggers"}:
                category = garment_type
                garment_type = "lower"
        if garment_type in {"lower_body"}:
            garment_type = "lower"
        if garment_type in {"upper_body"}:
            garment_type = "upper"
        return garment_type, category or None

    @staticmethod
    def _condition_garment(image: Image.Image) -> Image.Image:
        max_edge = max(1024, settings.garment_condition_max_edge)
        if max(image.size) <= max_edge:
            return image
        conditioned = image.copy()
        conditioned.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        return conditioned

    def run_tryon_with_metadata(
        self,
        person: Image.Image,
        cloth: Image.Image,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        garment_type: str | None = None,
        quality: str | None = None,
    ) -> TryOnResult:
        pipeline_start = time.perf_counter()
        timings: dict[str, int | list[int]] = {}
        quality_mode = self._normalize_quality(quality)
        candidates: list[TryOnCandidate] = []
        condition_cloth = self._condition_garment(cloth)
        analysis_start = time.perf_counter()
        person_analysis = analyze_person(person)
        garment_analysis = analyze_garment(condition_cloth)
        timings["analysis_ms"] = int((time.perf_counter() - analysis_start) * 1000)
        input_warnings = sorted(
            set([*person_analysis.validation_warnings, *garment_analysis.warnings])
        )

        generate_ms: list[int] = []
        postprocess_ms: list[int] = []
        for _index in range(1):
            seed = None
            generate_start = time.perf_counter()
            image = self.engine.generate(
                person,
                condition_cloth,
                inference_steps=inference_steps,
                guidance_scale=guidance_scale,
                seed=seed,
                garment_type=garment_type,
            )
            generate_ms.append(int((time.perf_counter() - generate_start) * 1000))
            safety_blocked = bool(getattr(self.engine, "last_safety_blocked", False))
            postprocess_start = time.perf_counter()
            if not safety_blocked:
                image = apply_quality_boosters(
                    image,
                    person=person,
                    garment=condition_cloth,
                    garment_type=garment_type,
                    tryon_mask=getattr(self.engine, "last_generation_mask", None),
                )
            postprocess_ms.append(int((time.perf_counter() - postprocess_start) * 1000))
            candidates.append(
                TryOnCandidate(
                    image=image,
                    seed=seed,
                    warnings=["SAFETY_CHECK_BLOCKED"] if safety_blocked else [],
                    metadata={"safety_blocked": safety_blocked},
                )
            )

        timings["candidate_generate_ms"] = generate_ms
        timings["candidate_postprocess_ms"] = postprocess_ms
        scoring_start = time.perf_counter()
        best, candidate_scores, warnings = self.scorer.choose_best(person, condition_cloth, candidates, garment_type=garment_type)
        timings["scoring_ms"] = int((time.perf_counter() - scoring_start) * 1000)
        timings["pipeline_total_ms"] = int((time.perf_counter() - pipeline_start) * 1000)
        warnings = sorted(set([*warnings, *input_warnings]))
        normalized_garment_type, lower_category = self._parse_garment_type(garment_type)
        quality_profile = (
            f"lower_body_v1_{lower_category}" if normalized_garment_type == "lower" and lower_category else
            "lower_body_v1" if normalized_garment_type == "lower" else
            "upper_body_standard"
        )
        if quality_profile == "lower_body_v1":
            warnings = sorted(set([*warnings, "LOWER_BODY_V1_REVIEW_REQUIRED"]))
        if normalized_garment_type == "lower" and lower_category:
            warnings = sorted(set([*warnings, "LOWER_BODY_V1_REVIEW_REQUIRED", f"LOWER_BODY_PROFILE:{lower_category.upper()}"]))
        if (best.score or 0.0) < settings.min_quality_score:
            warnings = sorted(set([*warnings, "QUALITY_SCORE_BELOW_THRESHOLD"]))

        return TryOnResult(
            image=best.image,
            engine=self.engine.name,
            quality_score=float(best.score or 0.0),
            candidate_count=len(candidates),
            candidate_scores=candidate_scores,
            warnings=warnings,
            metadata={
                "selected_seed": best.seed,
                "quality_mode": quality_mode,
                "quality_profile": quality_profile,
                "garment_type": normalized_garment_type,
                "garment_category": lower_category,
                "person_width": person_analysis.width,
                "person_height": person_analysis.height,
                "garment_width": cloth.width,
                "garment_height": cloth.height,
                "garment_condition_width": garment_analysis.width,
                "garment_condition_height": garment_analysis.height,
                "garment_foreground_ratio": garment_analysis.foreground_ratio,
                "garment_bbox_ratio": garment_analysis.bbox_ratio,
                "garment_background_ratio": garment_analysis.background_ratio,
                "garment_dominant_color": garment_analysis.dominant_color,
                "timings": timings,
                **best.metadata,
            },
        )

    def run_tryon_batch(self, persons: Iterable[Image.Image], cloths: Iterable[Image.Image]) -> List[Image.Image]:
        outputs: List[Image.Image] = []
        for person, cloth in zip(persons, cloths):
            outputs.append(self.run_tryon(person, cloth))
        return outputs
