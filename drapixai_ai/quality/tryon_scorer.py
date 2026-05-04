from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter

from drapixai_ai.engines.base import TryOnCandidate


@dataclass(frozen=True)
class TryOnScore:
    score: float
    warnings: list[str] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)


class TryOnScorer:
    """Lightweight first-pass scorer for candidate ranking.

    This intentionally avoids heavyweight face/CLIP dependencies for the first
    migration pass. Later scoring can plug in identity, CLIP, and artifact models
    behind this same interface.
    """

    def score_candidate(
        self,
        person: Image.Image,
        garment: Image.Image,
        candidate: Image.Image,
    ) -> TryOnScore:
        person_rgb = self._rgb(person, candidate.size)
        garment_rgb = self._rgb(garment, candidate.size)
        candidate_rgb = self._rgb(candidate, candidate.size)

        color_similarity = self._color_similarity(garment_rgb, candidate_rgb)
        body_similarity = self._body_similarity(person_rgb, candidate_rgb)
        face_similarity = self._face_similarity(person_rgb, candidate_rgb)
        texture_similarity = self._texture_similarity(garment_rgb, candidate_rgb)
        edge_quality = self._edge_quality(candidate_rgb)
        artifact_score = self._artifact_score(candidate_rgb)
        realism_score = self._realism_score(candidate_rgb)

        score = (
            0.22 * face_similarity
            + 0.20 * body_similarity
            + 0.20 * color_similarity
            + 0.16 * texture_similarity
            + 0.12 * edge_quality
            + 0.06 * artifact_score
            + 0.04 * realism_score
        )
        score = float(max(0.0, min(1.0, score)))

        warnings: list[str] = []
        if color_similarity < 0.45:
            warnings.append("GARMENT_COLOR_DRIFT")
        if body_similarity < 0.45:
            warnings.append("BODY_CHANGED_RISK")
        if face_similarity < 0.50:
            warnings.append("FACE_CHANGED_RISK")
        if edge_quality < 0.35:
            warnings.append("EDGE_ARTIFACT_RISK")
        if artifact_score < 0.55:
            warnings.append("IMAGE_ARTIFACT_RISK")
        if realism_score < 0.50:
            warnings.append("LOW_REALISM_RISK")

        return TryOnScore(
            score=score,
            warnings=warnings,
            metrics={
                "face_preservation": face_similarity,
                "body_preservation": body_similarity,
                "garment_color_similarity": color_similarity,
                "garment_texture_similarity": texture_similarity,
                "edge_quality": edge_quality,
                "artifact_score": artifact_score,
                "overall_realism": realism_score,
            },
        )

    def choose_best(
        self,
        person: Image.Image,
        garment: Image.Image,
        candidates: list[TryOnCandidate],
    ) -> tuple[TryOnCandidate, list[float], list[str]]:
        scored: list[TryOnCandidate] = []
        candidate_scores: list[float] = []
        warnings: list[str] = []

        for candidate in candidates:
            result = self.score_candidate(person, garment, candidate.image)
            candidate_scores.append(result.score)
            warnings.extend(result.warnings)
            scored.append(
                TryOnCandidate(
                    image=candidate.image,
                    seed=candidate.seed,
                    score=result.score,
                    warnings=result.warnings,
                    metadata={**candidate.metadata, **result.metrics},
                )
            )

        best = max(scored, key=lambda item: item.score or 0.0)
        return best, candidate_scores, sorted(set(warnings))

    @staticmethod
    def _rgb(image: Image.Image, size: tuple[int, int]) -> Image.Image:
        return image.convert("RGB").resize(size, Image.BICUBIC)

    @staticmethod
    def _center_crop_array(image: Image.Image) -> np.ndarray:
        arr = np.asarray(image).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        y0, y1 = int(h * 0.18), int(h * 0.82)
        x0, x1 = int(w * 0.18), int(w * 0.82)
        return arr[y0:y1, x0:x1]

    def _color_similarity(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_arr = self._center_crop_array(garment)
        candidate_arr = self._center_crop_array(candidate)
        diff = np.abs(garment_arr.mean(axis=(0, 1)) - candidate_arr.mean(axis=(0, 1))).mean()
        return float(1.0 - min(1.0, diff))

    def _body_similarity(self, person: Image.Image, candidate: Image.Image) -> float:
        person_arr = np.asarray(person.resize(candidate.size, Image.BICUBIC)).astype(np.float32) / 255.0
        candidate_arr = np.asarray(candidate).astype(np.float32) / 255.0
        border = max(8, int(min(candidate.size) * 0.08))
        person_border = np.concatenate(
            [
                person_arr[:border].reshape(-1, 3),
                person_arr[-border:].reshape(-1, 3),
                person_arr[:, :border].reshape(-1, 3),
                person_arr[:, -border:].reshape(-1, 3),
            ],
            axis=0,
        )
        candidate_border = np.concatenate(
            [
                candidate_arr[:border].reshape(-1, 3),
                candidate_arr[-border:].reshape(-1, 3),
                candidate_arr[:, :border].reshape(-1, 3),
                candidate_arr[:, -border:].reshape(-1, 3),
            ],
            axis=0,
        )
        diff = np.abs(person_border.mean(axis=0) - candidate_border.mean(axis=0)).mean()
        return float(1.0 - min(1.0, diff * 1.5))

    @staticmethod
    def _face_crop_array(image: Image.Image) -> np.ndarray:
        arr = np.asarray(image).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        y0, y1 = int(h * 0.05), int(h * 0.32)
        x0, x1 = int(w * 0.30), int(w * 0.70)
        return arr[y0:y1, x0:x1]

    def _face_similarity(self, person: Image.Image, candidate: Image.Image) -> float:
        person_face = self._face_crop_array(person)
        candidate_face = self._face_crop_array(candidate)
        color_diff = np.abs(person_face.mean(axis=(0, 1)) - candidate_face.mean(axis=(0, 1))).mean()
        contrast_diff = abs(float(person_face.std()) - float(candidate_face.std()))
        return float(1.0 - min(1.0, color_diff * 1.4 + contrast_diff * 0.8))

    def _texture_similarity(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_edges = self._center_crop_array(garment.convert("L").filter(ImageFilter.FIND_EDGES))
        candidate_edges = self._center_crop_array(candidate.convert("L").filter(ImageFilter.FIND_EDGES))
        diff = abs(float(garment_edges.std()) - float(candidate_edges.std()))
        return float(1.0 - min(1.0, diff * 3.0))

    @staticmethod
    def _edge_quality(candidate: Image.Image) -> float:
        edges = np.asarray(candidate.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        edge_density = float((edges > 0.20).mean())
        if edge_density < 0.02:
            return 0.35
        if edge_density > 0.45:
            return 0.45
        return 0.85

    @staticmethod
    def _artifact_score(candidate: Image.Image) -> float:
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        clipped = float(((arr < 0.015) | (arr > 0.985)).mean())
        channel_gap = float(np.abs(arr[:, :, 0] - arr[:, :, 1]).mean() + np.abs(arr[:, :, 1] - arr[:, :, 2]).mean())
        penalty = min(1.0, clipped * 4.0 + max(0.0, channel_gap - 0.34))
        return float(1.0 - penalty)

    @staticmethod
    def _realism_score(candidate: Image.Image) -> float:
        gray = np.asarray(candidate.convert("L")).astype(np.float32) / 255.0
        mean = float(gray.mean())
        contrast = float(gray.std())
        exposure = 1.0 - min(1.0, abs(mean - 0.52) * 2.0)
        contrast_score = 1.0 - min(1.0, abs(contrast - 0.22) * 2.2)
        return float(max(0.0, min(1.0, 0.55 * exposure + 0.45 * contrast_score)))
