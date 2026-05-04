from __future__ import annotations

import io
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
    def _candidate_count_for_quality(quality: str | None) -> int:
        normalized = (quality or "enhanced").strip().lower()
        if normalized == "standard":
            return 1
        return max(1, settings.candidate_count)

    def run_tryon_with_metadata(
        self,
        person: Image.Image,
        cloth: Image.Image,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        garment_type: str | None = None,
        quality: str | None = None,
    ) -> TryOnResult:
        candidate_count = self._candidate_count_for_quality(quality)
        candidates: list[TryOnCandidate] = []
        base_seed = 1009
        person_analysis = analyze_person(person)
        garment_analysis = analyze_garment(cloth)
        input_warnings = sorted(
            set([*person_analysis.validation_warnings, *garment_analysis.warnings])
        )

        for index in range(candidate_count):
            seed = base_seed + index if candidate_count > 1 else None
            image = self.engine.generate(
                person,
                cloth,
                inference_steps=inference_steps,
                guidance_scale=guidance_scale,
                seed=seed,
                garment_type=garment_type,
            )
            image = apply_quality_boosters(image, person=person, garment=cloth)
            candidates.append(TryOnCandidate(image=image, seed=seed))

        best, candidate_scores, warnings = self.scorer.choose_best(person, cloth, candidates)
        warnings = sorted(set([*warnings, *input_warnings]))
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
                "quality_mode": quality or "enhanced",
                "person_width": person_analysis.width,
                "person_height": person_analysis.height,
                "garment_width": garment_analysis.width,
                "garment_height": garment_analysis.height,
                "garment_foreground_ratio": garment_analysis.foreground_ratio,
                "garment_dominant_color": garment_analysis.dominant_color,
                **best.metadata,
            },
        )

    def run_tryon_batch(self, persons: Iterable[Image.Image], cloths: Iterable[Image.Image]) -> List[Image.Image]:
        outputs: List[Image.Image] = []
        for person, cloth in zip(persons, cloths):
            outputs.append(self.run_tryon(person, cloth))
        return outputs
