from __future__ import annotations

import io
import time
from typing import Iterable, List, Sequence

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
        self.lower_engine: TryOnEngine | None = None
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
        if normalized in {"fashn", "fashn_vton", "fashn_vton_1_5"}:
            from drapixai_ai.engines.fashn_vton import FashnVTONEngine

            return FashnVTONEngine()
        raise ValueError(f"Unsupported try-on engine: {engine_name}")

    def _engine_for(self, garment_type: str | None) -> TryOnEngine:
        family, _category = self._parse_garment_type(garment_type)
        if family != "lower":
            return self.engine
        if not settings.enable_lower_body:
            raise RuntimeError("LOWER_BODY_NOT_ENABLED")

        lower_name = settings.lower_body_engine.strip().lower().replace("-", "_")
        upper_name = settings.tryon_engine.strip().lower().replace("-", "_")
        if lower_name == upper_name or {lower_name, upper_name} <= {"catvton", "cat_vton"}:
            return self.engine
        lower_engine = getattr(self, "lower_engine", None)
        if lower_engine is None:
            lower_engine = self._build_engine(lower_name)
            self.lower_engine = lower_engine
        return lower_engine

    def preload(self, role: str | None = None) -> None:
        normalized = (role or "upper").strip().lower()
        if normalized in {"upper", "both"}:
            self.engine.load()
        if normalized in {"lower", "both"}:
            self._engine_for("lower:pants").load()

    def run_tryon(
        self,
        person: Image.Image,
        cloth: Image.Image,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        garment_type: str | None = None,
        quality: str | None = None,
        seed: int | None = None,
    ) -> Image.Image:
        return self.run_tryon_with_metadata(
            person,
            cloth,
            inference_steps=inference_steps,
            guidance_scale=guidance_scale,
            garment_type=garment_type,
            quality=quality,
            seed=seed,
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
        seed: int | None = None,
    ) -> TryOnResult:
        pipeline_start = time.perf_counter()
        timings: dict[str, int | list[int]] = {}
        quality_mode = self._normalize_quality(quality)
        candidates: list[TryOnCandidate] = []
        condition_cloth = self._condition_garment(cloth)
        active_engine = self._engine_for(garment_type)
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
            generate_start = time.perf_counter()
            image = active_engine.generate(
                person,
                condition_cloth,
                inference_steps=inference_steps,
                guidance_scale=guidance_scale,
                seed=seed,
                garment_type=garment_type,
            )
            generate_ms.append(int((time.perf_counter() - generate_start) * 1000))
            safety_blocked = bool(getattr(active_engine, "last_safety_blocked", False))
            postprocess_start = time.perf_counter()
            postprocess_applied = not safety_blocked and self._should_postprocess(
                active_engine, garment_type
            )
            if postprocess_applied:
                image = apply_quality_boosters(
                    image,
                    person=person,
                    garment=condition_cloth,
                    garment_type=garment_type,
                    tryon_mask=getattr(active_engine, "last_generation_mask", None),
                )
            postprocess_ms.append(int((time.perf_counter() - postprocess_start) * 1000))
            candidates.append(
                TryOnCandidate(
                    image=image,
                    seed=seed,
                    warnings=["SAFETY_CHECK_BLOCKED"] if safety_blocked else [],
                    metadata={
                        "safety_blocked": safety_blocked,
                        "postprocess_applied": postprocess_applied,
                    },
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
            engine=active_engine.name,
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

    @staticmethod
    def _should_postprocess(active_engine: TryOnEngine, garment_type: str | None) -> bool:
        family, _category = DrapixAITryOnPipeline._parse_garment_type(garment_type)
        if family == "lower" and active_engine.name == "fashn_vton_1_5":
            return settings.fashn_enable_postprocess
        return True

    def run_tryon_batch(self, persons: Iterable[Image.Image], cloths: Iterable[Image.Image]) -> List[Image.Image]:
        return [
            result.image
            for result in self.run_tryon_batch_with_metadata(
                list(persons),
                list(cloths),
            )
        ]

    def run_tryon_batch_with_metadata(
        self,
        persons: Sequence[Image.Image],
        cloths: Sequence[Image.Image],
        *,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        garment_types: Sequence[str | None] | None = None,
        qualities: Sequence[str | None] | None = None,
    ) -> list[TryOnResult]:
        batch_start = time.perf_counter()
        count = len(persons)
        if count == 0:
            return []
        if len(cloths) != count:
            raise ValueError("BATCH_INPUT_LENGTH_MISMATCH")
        batch_types = list(garment_types) if garment_types is not None else [None] * count
        batch_qualities = list(qualities) if qualities is not None else [None] * count
        if len(batch_types) != count or len(batch_qualities) != count:
            raise ValueError("BATCH_INPUT_LENGTH_MISMATCH")

        conditioned_cloths = [self._condition_garment(cloth) for cloth in cloths]
        person_analyses = []
        garment_analyses = []
        input_warnings: list[list[str]] = []
        analysis_ms: list[int] = []
        for person, cloth in zip(persons, conditioned_cloths):
            analysis_start = time.perf_counter()
            person_analysis = analyze_person(person)
            garment_analysis = analyze_garment(cloth)
            person_analyses.append(person_analysis)
            garment_analyses.append(garment_analysis)
            input_warnings.append(
                sorted(
                    set(
                        [
                            *person_analysis.validation_warnings,
                            *garment_analysis.warnings,
                        ]
                    )
                )
            )
            analysis_ms.append(int((time.perf_counter() - analysis_start) * 1000))

        generate_start = time.perf_counter()
        active_engines = [self._engine_for(garment_type) for garment_type in batch_types]
        homogeneous_engine = all(engine is active_engines[0] for engine in active_engines)
        if homogeneous_engine:
            active_engine = active_engines[0]
            images = active_engine.generate_batch(
                persons,
                conditioned_cloths,
                inference_steps=inference_steps,
                guidance_scale=guidance_scale,
                seeds=[None] * count,
                garment_types=batch_types,
            )
            safety_flags = list(
                getattr(active_engine, "last_safety_blocked_flags", [False] * count)
            )
            generation_masks = list(
                getattr(active_engine, "last_generation_masks", [None] * count)
            )
        else:
            images = []
            safety_flags = []
            generation_masks = []
            for person, cloth, garment_type, active_engine in zip(
                persons, conditioned_cloths, batch_types, active_engines
            ):
                images.append(
                    active_engine.generate(
                        person,
                        cloth,
                        inference_steps=inference_steps,
                        guidance_scale=guidance_scale,
                        garment_type=garment_type,
                    )
                )
                safety_flags.append(
                    bool(getattr(active_engine, "last_safety_blocked", False))
                )
                generation_masks.append(
                    getattr(active_engine, "last_generation_mask", None)
                )
        batch_generate_ms = int((time.perf_counter() - generate_start) * 1000)
        if len(images) != count:
            raise RuntimeError("BATCH_OUTPUT_LENGTH_MISMATCH")

        if len(safety_flags) != count:
            safety_flags = [False] * count
        if len(generation_masks) != count:
            generation_masks = [None] * count

        results: list[TryOnResult] = []
        for index, (
            person,
            original_cloth,
            conditioned_cloth,
            image,
            garment_type,
            quality,
            person_analysis,
            garment_analysis,
        ) in enumerate(
            zip(
                persons,
                cloths,
                conditioned_cloths,
                images,
                batch_types,
                batch_qualities,
                person_analyses,
                garment_analyses,
            )
        ):
            safety_blocked = bool(safety_flags[index])
            postprocess_start = time.perf_counter()
            postprocess_applied = not safety_blocked and self._should_postprocess(
                active_engines[index], garment_type
            )
            if postprocess_applied:
                image = apply_quality_boosters(
                    image,
                    person=person,
                    garment=conditioned_cloth,
                    garment_type=garment_type,
                    tryon_mask=generation_masks[index],
                )
            postprocess_ms = int((time.perf_counter() - postprocess_start) * 1000)
            candidate = TryOnCandidate(
                image=image,
                seed=None,
                warnings=["SAFETY_CHECK_BLOCKED"] if safety_blocked else [],
                metadata={
                    "safety_blocked": safety_blocked,
                    "postprocess_applied": postprocess_applied,
                },
            )

            scoring_start = time.perf_counter()
            best, candidate_scores, warnings = self.scorer.choose_best(
                person,
                conditioned_cloth,
                [candidate],
                garment_type=garment_type,
            )
            scoring_ms = int((time.perf_counter() - scoring_start) * 1000)
            warnings = sorted(set([*warnings, *input_warnings[index]]))
            normalized_garment_type, lower_category = self._parse_garment_type(
                garment_type
            )
            quality_profile = (
                f"lower_body_v1_{lower_category}"
                if normalized_garment_type == "lower" and lower_category
                else "lower_body_v1"
                if normalized_garment_type == "lower"
                else "upper_body_standard"
            )
            if quality_profile == "lower_body_v1":
                warnings = sorted(
                    set([*warnings, "LOWER_BODY_V1_REVIEW_REQUIRED"])
                )
            if normalized_garment_type == "lower" and lower_category:
                warnings = sorted(
                    set(
                        [
                            *warnings,
                            "LOWER_BODY_V1_REVIEW_REQUIRED",
                            f"LOWER_BODY_PROFILE:{lower_category.upper()}",
                        ]
                    )
                )
            if (best.score or 0.0) < settings.min_quality_score:
                warnings = sorted(
                    set([*warnings, "QUALITY_SCORE_BELOW_THRESHOLD"])
                )

            timings: dict[str, int | list[int]] = {
                "analysis_ms": analysis_ms[index],
                "candidate_generate_ms": [batch_generate_ms],
                "batch_generate_ms": batch_generate_ms,
                "candidate_postprocess_ms": [postprocess_ms],
                "scoring_ms": scoring_ms,
                "pipeline_total_ms": int(
                    (time.perf_counter() - batch_start) * 1000
                ),
            }
            results.append(
                TryOnResult(
                    image=best.image,
                    engine=active_engines[index].name,
                    quality_score=float(best.score or 0.0),
                    candidate_count=1,
                    candidate_scores=candidate_scores,
                    warnings=warnings,
                    metadata={
                        "selected_seed": best.seed,
                        "quality_mode": self._normalize_quality(quality),
                        "quality_profile": quality_profile,
                        "garment_type": normalized_garment_type,
                        "garment_category": lower_category,
                        "person_width": person_analysis.width,
                        "person_height": person_analysis.height,
                        "garment_width": original_cloth.width,
                        "garment_height": original_cloth.height,
                        "garment_condition_width": garment_analysis.width,
                        "garment_condition_height": garment_analysis.height,
                        "garment_foreground_ratio": garment_analysis.foreground_ratio,
                        "garment_bbox_ratio": garment_analysis.bbox_ratio,
                        "garment_background_ratio": garment_analysis.background_ratio,
                        "garment_dominant_color": garment_analysis.dominant_color,
                        "batch_size": count,
                        "batch_index": index,
                        "true_gpu_batch": count > 1,
                        "timings": timings,
                        **best.metadata,
                    },
                )
            )
        return results
