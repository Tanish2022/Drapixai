from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter

from drapixai_ai.engines.base import TryOnCandidate
from drapixai_ai.preprocess.garment_analyzer import prepare_garment_for_tryon
from drapixai_ai.preprocess.lower_body_regions import build_lower_body_region_masks
from drapixai_ai.preprocess.mask_builder import build_lower_body_mask_for_category


LOWER_BODY_CATEGORY_PROFILES: dict[str, dict[str, float | str]] = {
    "jeans": {"label": "jeans", "coverage_min": 0.60, "hem_min": 0.50, "shoe_weight": 0.06, "crotch_weight": 0.03, "crotch_min": 0.55},
    "pants": {"label": "pants", "coverage_min": 0.60, "hem_min": 0.50, "shoe_weight": 0.06, "crotch_weight": 0.03, "crotch_min": 0.55},
    "trousers": {"label": "trousers", "coverage_min": 0.60, "hem_min": 0.50, "shoe_weight": 0.06, "crotch_weight": 0.03, "crotch_min": 0.55},
    "shorts": {"label": "shorts", "coverage_min": 0.42, "hem_min": 0.56, "shoe_weight": 0.03, "crotch_weight": 0.04, "crotch_min": 0.50},
    "skirt": {"label": "skirt", "coverage_min": 0.48, "hem_min": 0.58, "shoe_weight": 0.03, "crotch_weight": 0.01, "crotch_min": 0.0},
    "leggings": {"label": "leggings", "coverage_min": 0.64, "hem_min": 0.48, "shoe_weight": 0.05, "crotch_weight": 0.04, "crotch_min": 0.58},
    "joggers": {"label": "joggers", "coverage_min": 0.58, "hem_min": 0.48, "shoe_weight": 0.07, "crotch_weight": 0.02, "crotch_min": 0.52},
}


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
        *,
        garment_type: str | None = None,
    ) -> TryOnScore:
        person_rgb = self._rgb(person, candidate.size)
        garment_rgb = prepare_garment_for_tryon(garment, candidate.size)
        candidate_rgb = self._rgb(candidate, candidate.size)
        normalized_garment_type, lower_category = self._parse_garment_type(garment_type)
        if normalized_garment_type == "lower":
            return self._score_lower_body_candidate(person_rgb, garment_rgb, candidate_rgb, category=lower_category)

        color_similarity = self._color_similarity(garment_rgb, candidate_rgb)
        body_similarity = self._body_similarity(person_rgb, candidate_rgb)
        face_similarity = self._face_similarity(person_rgb, candidate_rgb)
        texture_similarity = self._texture_similarity(garment_rgb, candidate_rgb)
        edge_quality = self._edge_quality(candidate_rgb)
        artifact_score = self._artifact_score(candidate_rgb)
        rectangular_artifact_score = self._rectangular_artifact_score(candidate_rgb)
        background_cast_score = self._background_cast_score(person_rgb, garment_rgb, candidate_rgb)
        realism_score = self._realism_score(candidate_rgb)
        garment_structure = self._garment_structure_score(garment_rgb, candidate_rgb)
        hem_quality = self._hem_quality(candidate_rgb)
        untucked_hem_presence = self._untucked_hem_presence(garment_rgb, candidate_rgb)
        long_sleeve_preservation = self._long_sleeve_preservation(garment_rgb, candidate_rgb)
        pose_preservation = self._pose_preservation(person_rgb, candidate_rgb)
        garment_coverage = self._garment_coverage_score(garment_rgb, candidate_rgb)

        score = (
            0.19 * face_similarity
            + 0.14 * body_similarity
            + 0.15 * pose_preservation
            + 0.13 * color_similarity
            + 0.12 * texture_similarity
            + 0.10 * garment_structure
            + 0.07 * edge_quality
            + 0.07 * untucked_hem_presence
            + 0.06 * long_sleeve_preservation
            + 0.03 * hem_quality
            + 0.03 * artifact_score
            + 0.03 * rectangular_artifact_score
            + 0.03 * background_cast_score
            + 0.01 * realism_score
        )
        score *= 0.72 + 0.28 * garment_coverage
        score = float(max(0.0, min(1.0, score)))

        warnings: list[str] = []
        if color_similarity < 0.45:
            warnings.append("GARMENT_COLOR_DRIFT")
        if body_similarity < 0.45:
            warnings.append("BODY_CHANGED_RISK")
        if pose_preservation < 0.58:
            warnings.append("POSE_CHANGED_RISK")
        if face_similarity < 0.50:
            warnings.append("FACE_CHANGED_RISK")
        if edge_quality < 0.35:
            warnings.append("EDGE_ARTIFACT_RISK")
        if artifact_score < 0.55:
            warnings.append("IMAGE_ARTIFACT_RISK")
        if rectangular_artifact_score < 0.72:
            warnings.append("RECTANGULAR_BLEND_ARTIFACT_RISK")
        if background_cast_score < 0.72:
            warnings.append("BACKGROUND_COLOR_CAST_RISK")
        if realism_score < 0.50:
            warnings.append("LOW_REALISM_RISK")
        if garment_structure < 0.48:
            warnings.append("GARMENT_SHAPE_DRIFT")
        if hem_quality < 0.55:
            warnings.append("GARMENT_HEM_BLEND_RISK")
        if untucked_hem_presence < 0.42:
            warnings.append("GARMENT_TUCKED_HEM_RISK")
        if long_sleeve_preservation < 0.45:
            warnings.append("GARMENT_SLEEVE_LENGTH_DRIFT")
        if garment_coverage < 0.72:
            warnings.append("GARMENT_COVERAGE_INCOMPLETE")

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
                "rectangular_artifact_score": rectangular_artifact_score,
                "background_cast_score": background_cast_score,
                "overall_realism": realism_score,
                "garment_structure": garment_structure,
                "hem_quality": hem_quality,
                "untucked_hem_presence": untucked_hem_presence,
                "long_sleeve_preservation": long_sleeve_preservation,
                "pose_preservation": pose_preservation,
                "garment_coverage": garment_coverage,
            },
        )

    def choose_best(
        self,
        person: Image.Image,
        garment: Image.Image,
        candidates: list[TryOnCandidate],
        *,
        garment_type: str | None = None,
    ) -> tuple[TryOnCandidate, list[float], list[str]]:
        scored: list[TryOnCandidate] = []
        candidate_scores: list[float] = []

        for candidate in candidates:
            if candidate.metadata.get("safety_blocked"):
                candidate_scores.append(0.0)
                scored.append(
                    TryOnCandidate(
                        image=candidate.image,
                        seed=candidate.seed,
                        score=0.0,
                        warnings=sorted(set([*candidate.warnings, "SAFETY_CHECK_BLOCKED"])),
                        metadata=candidate.metadata,
                    )
                )
                continue

            result = self.score_candidate(person, garment, candidate.image, garment_type=garment_type)
            candidate_scores.append(result.score)
            scored.append(
                TryOnCandidate(
                    image=candidate.image,
                    seed=candidate.seed,
                    score=result.score,
                    warnings=sorted(set([*candidate.warnings, *result.warnings])),
                    metadata={**candidate.metadata, **result.metrics},
                )
            )

        best = max(scored, key=lambda item: item.score or 0.0)
        return best, candidate_scores, sorted(set(best.warnings))

    def _score_lower_body_candidate(
        self,
        person: Image.Image,
        garment: Image.Image,
        candidate: Image.Image,
        *,
        category: str | None = None,
    ) -> TryOnScore:
        profile = LOWER_BODY_CATEGORY_PROFILES.get(category or "", LOWER_BODY_CATEGORY_PROFILES["pants"])
        region_masks = build_lower_body_region_masks(candidate, category)
        candidate_garment_mask = self._candidate_lower_garment_mask(
            garment, candidate, category
        )
        color_similarity = self._color_similarity(garment, candidate)
        texture_similarity = self._texture_similarity(garment, candidate)
        face_similarity = self._face_similarity(person, candidate)
        upper_body_preservation = self._upper_body_preservation(person, candidate)
        background_cast_score = self._background_cast_score(person, garment, candidate)
        pose_preservation = self._lower_pose_preservation(person, candidate)
        shoe_preservation = self._shoe_preservation(person, candidate, region_masks["shoe"])
        waistband_alignment = self._waistband_alignment(candidate, region_masks["waist"])
        left_leg_integrity = self._single_leg_integrity(candidate, "left")
        right_leg_integrity = self._single_leg_integrity(candidate, "right")
        knee_preservation = self._knee_preservation(candidate, region_masks["knee"])
        ankle_preservation = self._ankle_preservation(candidate, region_masks["ankle"])
        lower_garment_coverage = self._lower_garment_coverage_score(garment, candidate)
        hem_alignment = self._lower_hem_alignment(candidate, region_masks["hem"])
        crotch_artifact_score = self._crotch_artifact_score(candidate, region_masks["crotch"])
        layered_garment_score = self._layered_garment_score(
            person, candidate, category, candidate_garment_mask
        )
        revealed_leg_integrity = self._revealed_leg_integrity(
            person, candidate, category
        )
        edge_quality = self._edge_quality(candidate)
        artifact_score = self._artifact_score(candidate)
        rectangular_artifact_score = self._rectangular_artifact_score(candidate)
        realism_score = self._realism_score(candidate)

        score = (
            0.14 * face_similarity
            + 0.13 * upper_body_preservation
            + 0.12 * pose_preservation
            + 0.10 * color_similarity
            + 0.09 * texture_similarity
            + 0.08 * lower_garment_coverage
            + 0.07 * waistband_alignment
            + 0.06 * min(left_leg_integrity, right_leg_integrity)
            + float(profile["shoe_weight"]) * shoe_preservation
            + 0.05 * knee_preservation
            + 0.04 * ankle_preservation
            + 0.03 * hem_alignment
            + float(profile["crotch_weight"]) * crotch_artifact_score
            + 0.03 * edge_quality
            + 0.03 * artifact_score
            + 0.02 * rectangular_artifact_score
            + 0.01 * background_cast_score
            + 0.01 * realism_score
        )
        score = float(max(0.0, min(1.0, score)))

        warnings: list[str] = []
        if color_similarity < 0.45:
            warnings.append("LOWER_GARMENT_COLOR_DRIFT")
        if texture_similarity < 0.45:
            warnings.append("LOWER_GARMENT_TEXTURE_DRIFT")
        if face_similarity < 0.50:
            warnings.append("FACE_CHANGED_RISK")
        if upper_body_preservation < 0.58:
            warnings.append("UPPER_BODY_CHANGED_RISK")
        if background_cast_score < 0.72:
            warnings.append("BACKGROUND_COLOR_CAST_RISK")
        if pose_preservation < 0.55:
            warnings.append("LOWER_BODY_POSE_CHANGED_RISK")
        if shoe_preservation < 0.55:
            warnings.append("SHOE_CHANGED_RISK")
        if waistband_alignment < 0.50:
            warnings.append("WAISTBAND_MISALIGNED")
        if left_leg_integrity < 0.50:
            warnings.append("LEFT_LEG_ARTIFACT_RISK")
        if right_leg_integrity < 0.50:
            warnings.append("RIGHT_LEG_ARTIFACT_RISK")
        if knee_preservation < 0.50:
            warnings.append("KNEE_ARTIFACT_RISK")
        if ankle_preservation < 0.50:
            warnings.append("ANKLE_ARTIFACT_RISK")
        if lower_garment_coverage < float(profile["coverage_min"]):
            warnings.append("LOWER_GARMENT_COVERAGE_INCOMPLETE")
        if hem_alignment < float(profile["hem_min"]):
            warnings.append(f"{str(profile['label']).upper()}_HEM_ALIGNMENT_RISK")
        if crotch_artifact_score < float(profile["crotch_min"]):
            warnings.append("CROTCH_ARTIFACT_RISK")
        if artifact_score < 0.55:
            warnings.append("IMAGE_ARTIFACT_RISK")

        return TryOnScore(
            score=score,
            warnings=warnings,
            metrics={
                "face_preservation": face_similarity,
                "upper_body_preservation": upper_body_preservation,
                "background_cast_score": background_cast_score,
                "pose_preservation": pose_preservation,
                "shoe_preservation": shoe_preservation,
                "waistband_alignment": waistband_alignment,
                "left_leg_integrity": left_leg_integrity,
                "right_leg_integrity": right_leg_integrity,
                "knee_preservation": knee_preservation,
                "ankle_preservation": ankle_preservation,
                "lower_garment_color_similarity": color_similarity,
                "lower_garment_texture_similarity": texture_similarity,
                "lower_garment_coverage": lower_garment_coverage,
                "hem_alignment": hem_alignment,
                "crotch_artifact_score": crotch_artifact_score,
                "experimental_layered_garment_score": layered_garment_score,
                "experimental_revealed_leg_integrity": revealed_leg_integrity,
                "edge_quality": edge_quality,
                "artifact_score": artifact_score,
                "rectangular_artifact_score": rectangular_artifact_score,
                "overall_realism": realism_score,
                "lower_body_category_profile": float(self._category_profile_code(str(profile["label"]))),
                f"{str(profile['label'])}_profile_score": score,
            },
        )

    @staticmethod
    def _parse_garment_type(value: str | None) -> tuple[str, str | None]:
        normalized = (value or "upper").strip().lower().replace("-", "_")
        category = None
        if ":" in normalized:
            garment_type, category = normalized.split(":", 1)
        else:
            garment_type = normalized
            if garment_type in LOWER_BODY_CATEGORY_PROFILES:
                category = garment_type
                garment_type = "lower"
        if garment_type in {"lower_body"}:
            garment_type = "lower"
        if garment_type in {"upper_body"}:
            garment_type = "upper"
        return garment_type, category or None

    @staticmethod
    def _category_profile_code(category: str) -> int:
        order = ["jeans", "pants", "trousers", "shorts", "skirt", "leggings", "joggers"]
        try:
            return order.index(category) + 1
        except ValueError:
            return 0

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

    def _pose_preservation(self, person: Image.Image, candidate: Image.Image) -> float:
        person_edges = self._pose_edge_map(person)
        candidate_edges = self._pose_edge_map(candidate)
        if person_edges.size == 0 or candidate_edges.size == 0:
            return 0.55

        h, w = person_edges.shape
        yy, xx = np.mgrid[0:h, 0:w]
        preserve_region = (
            (yy < h * 0.34)
            | (yy > h * 0.78)
            | (xx < w * 0.24)
            | (xx > w * 0.76)
        )
        preserve_region &= ~((yy > h * 0.34) & (yy < h * 0.78) & (xx > w * 0.28) & (xx < w * 0.72))
        p = person_edges[preserve_region]
        c = candidate_edges[preserve_region]
        if p.size == 0 or c.size == 0:
            return 0.55

        density_score = 1.0 - min(1.0, abs(float(p.mean()) - float(c.mean())) * 4.5)
        row_score = 1.0 - min(1.0, float(np.abs(person_edges.mean(axis=1) - candidate_edges.mean(axis=1)).mean()) * 8.0)
        col_score = 1.0 - min(1.0, float(np.abs(person_edges.mean(axis=0) - candidate_edges.mean(axis=0)).mean()) * 8.0)
        overlap = float((p & c).sum() / max(1, (p | c).sum()))
        return float(max(0.0, min(1.0, 0.30 * density_score + 0.25 * row_score + 0.25 * col_score + 0.20 * overlap)))

    @staticmethod
    def _pose_edge_map(image: Image.Image) -> np.ndarray:
        edges = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        return edges > 0.16

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

    def _garment_structure_score(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_edges = self._upper_body_edges(garment)
        candidate_edges = self._upper_body_edges(candidate)
        garment_density = float((garment_edges > 0.18).mean())
        candidate_density = float((candidate_edges > 0.18).mean())
        density_score = 1.0 - min(1.0, abs(garment_density - candidate_density) * 4.5)

        garment_vertical = garment_edges.mean(axis=1)
        candidate_vertical = candidate_edges.mean(axis=1)
        profile_diff = float(np.abs(garment_vertical - candidate_vertical).mean())
        profile_score = 1.0 - min(1.0, profile_diff * 7.0)

        return float(max(0.0, min(1.0, 0.55 * density_score + 0.45 * profile_score)))

    @staticmethod
    def _upper_body_edges(image: Image.Image) -> np.ndarray:
        arr = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        return arr[int(h * 0.24) : int(h * 0.80), int(w * 0.16) : int(w * 0.84)]

    @staticmethod
    def _hem_quality(candidate: Image.Image) -> float:
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        hem = arr[int(h * 0.66) : int(h * 0.80), int(w * 0.22) : int(w * 0.78)]
        lower = arr[int(h * 0.80) : int(h * 0.90), int(w * 0.22) : int(w * 0.78)]
        if hem.size == 0 or lower.size == 0:
            return 0.55
        hem_edges = np.asarray(
            Image.fromarray((hem * 255).astype(np.uint8)).convert("L").filter(ImageFilter.FIND_EDGES)
        ).astype(np.float32) / 255.0
        edge_density = float((hem_edges > 0.18).mean())
        color_gap = float(np.abs(hem.mean(axis=(0, 1)) - lower.mean(axis=(0, 1))).mean())
        boundary_score = 1.0 - min(1.0, abs(edge_density - 0.12) * 3.0)
        separation_score = min(1.0, color_gap * 4.5)
        return float(max(0.0, min(1.0, 0.55 * boundary_score + 0.45 * separation_score)))

    @staticmethod
    def _foreground_mask_array(arr: np.ndarray) -> np.ndarray:
        """Separate a product garment from its plain preparation canvas.

        Neutral black, white, and gray fabrics must remain foreground. Chroma
        thresholds incorrectly classify those garments as background and make
        coverage/hem scores follow a logo or print instead of the fabric.
        """
        h, w = arr.shape[:2]
        sample = max(2, min(h, w) // 18)
        corners = np.concatenate(
            [
                arr[:sample, :sample].reshape(-1, 3),
                arr[:sample, -sample:].reshape(-1, 3),
                arr[-sample:, :sample].reshape(-1, 3),
                arr[-sample:, -sample:].reshape(-1, 3),
            ],
            axis=0,
        )
        background = np.median(corners, axis=0)
        distance = np.linalg.norm(arr - background, axis=2)
        luma_gap = np.abs(arr.mean(axis=2) - float(background.mean()))
        return (distance > 0.045) | (luma_gap > 0.028)

    @classmethod
    def _foreground_pixels(cls, image: Image.Image) -> np.ndarray:
        arr = np.asarray(image.convert("RGB")).astype(np.float32) / 255.0
        foreground = cls._foreground_mask_array(arr)
        pixels = arr[foreground]
        if pixels.size == 0:
            return arr.reshape(-1, 3)
        return pixels

    @classmethod
    def _foreground_palette(cls, image: Image.Image, colors: int = 8) -> np.ndarray:
        pixels = cls._foreground_pixels(image)
        if len(pixels) > 50_000:
            indices = np.linspace(0, len(pixels) - 1, 50_000, dtype=np.int64)
            pixels = pixels[indices]
        bins = np.clip((pixels * 15.0).astype(np.int16), 0, 15)
        packed = bins[:, 0] * 256 + bins[:, 1] * 16 + bins[:, 2]
        values, counts = np.unique(packed, return_counts=True)
        order = np.argsort(counts)[::-1][: max(1, colors)]
        palette = []
        for value in values[order]:
            member = packed == value
            palette.append(pixels[member].mean(axis=0))
        return np.asarray(palette, dtype=np.float32)

    def _untucked_hem_presence(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_arr = np.asarray(garment.convert("RGB")).astype(np.float32) / 255.0
        h, w = garment_arr.shape[:2]
        garment_lower = garment_arr[int(h * 0.58) : int(h * 0.90), int(w * 0.24) : int(w * 0.76)]
        garment_foreground = self._foreground_mask_array(garment_arr)
        garment_lower_pixels = garment_lower[
            garment_foreground[int(h * 0.58) : int(h * 0.90), int(w * 0.24) : int(w * 0.76)]
        ]
        if garment_lower_pixels.size == 0:
            return 0.65

        garment_color = np.median(self._foreground_pixels(garment), axis=0)
        candidate_arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        ch, cw = candidate_arr.shape[:2]
        lower_y0 = int(ch * 0.62)
        lower_y1 = int(ch * 0.86)
        lower_x0 = int(cw * 0.26)
        lower_x1 = int(cw * 0.74)
        lower_region = candidate_arr[lower_y0:lower_y1, lower_x0:lower_x1]
        if lower_region.size == 0:
            return 0.45

        color_distance = np.linalg.norm(lower_region - garment_color, axis=2)
        garment_like = color_distance < 0.26
        row_coverage = garment_like.mean(axis=1)
        visible_rows = np.where(row_coverage > 0.28)[0]
        garment_like_ratio = float(garment_like.mean())
        if visible_rows.size == 0:
            return float(max(0.0, min(1.0, garment_like_ratio * 1.8)))

        bottom_norm = (lower_y0 + int(visible_rows.max())) / max(1, ch)
        coverage_score = min(1.0, garment_like_ratio * 4.0)
        if bottom_norm < 0.72:
            boundary_score = max(0.0, (bottom_norm - 0.62) / 0.10)
        elif bottom_norm <= 0.84:
            boundary_score = 1.0
        else:
            boundary_score = max(0.0, 1.0 - ((bottom_norm - 0.84) / 0.08))
        mean_similarity = 1.0 - min(
            1.0,
            float(np.linalg.norm(lower_region[garment_like].mean(axis=0) - garment_color)) * 1.6
            if garment_like.any()
            else 1.0,
        )
        return float(max(0.0, min(1.0, 0.45 * coverage_score + 0.40 * boundary_score + 0.15 * mean_similarity)))

    def _long_sleeve_preservation(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_arr = np.asarray(garment.convert("RGB")).astype(np.float32) / 255.0
        sleeve_style = self._sleeve_style(garment_arr)
        if sleeve_style not in {"full_length", "folded_cuff", "rolled_sleeve"}:
            return 0.75

        garment_color = np.median(self._foreground_pixels(garment), axis=0)
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        left_region = (yy > h * 0.46) & (yy < h * 0.78) & (xx > w * 0.10) & (xx < w * 0.27)
        right_region = (yy > h * 0.46) & (yy < h * 0.78) & (xx > w * 0.73) & (xx < w * 0.90)
        sleeve_region = left_region | right_region
        if not left_region.any() or not right_region.any():
            return 0.35

        sleeve_pixels = arr[sleeve_region]
        color_distance = np.linalg.norm(sleeve_pixels - garment_color, axis=1)
        garment_like_flat = color_distance < 0.27

        sleeve_map = np.zeros((h, w), dtype=bool)
        sleeve_map[sleeve_region] = garment_like_flat
        target_bottom = self._target_sleeve_bottom(sleeve_style)
        left_score = self._single_sleeve_score(sleeve_map & left_region, left_region, target_bottom)
        right_score = self._single_sleeve_score(sleeve_map & right_region, right_region, target_bottom)
        return float(max(0.0, min(1.0, min(left_score, right_score))))

    @staticmethod
    def _single_sleeve_score(garment_like: np.ndarray, sleeve_region: np.ndarray, target_bottom: float) -> float:
        h = garment_like.shape[0]
        y0 = int(h * 0.46)
        y1 = int(h * 0.78)
        if y1 <= y0:
            return 0.35
        region_rows = sleeve_region[y0:y1]
        garment_rows = garment_like[y0:y1]
        row_width = np.maximum(1, region_rows.sum(axis=1))
        row_coverage = garment_rows.sum(axis=1) / row_width
        visible_rows = np.where(row_coverage > 0.24)[0]
        garment_like_ratio = float(garment_rows.sum() / max(1, region_rows.sum()))
        if visible_rows.size == 0:
            return float(max(0.0, min(1.0, garment_like_ratio * 1.4)))

        sleeve_bottom = (y0 + int(visible_rows.max())) / max(1, h)
        bottom_error = abs(sleeve_bottom - target_bottom)
        reach_score = 1.0 - min(1.0, bottom_error / 0.12)
        lower_band = row_coverage[int(len(row_coverage) * 0.62) :]
        lower_coverage_score = min(1.0, float(lower_band.mean()) * 3.0) if lower_band.size else 0.0
        coverage_score = min(1.0, garment_like_ratio * 3.2)
        return float(max(0.0, min(1.0, 0.45 * reach_score + 0.35 * lower_coverage_score + 0.20 * coverage_score)))

    @staticmethod
    def _sleeve_style(garment_arr: np.ndarray) -> str:
        h, w = garment_arr.shape[:2]
        foreground = TryOnScorer._foreground_mask_array(garment_arr)
        ys, xs = np.where(foreground)
        if xs.size == 0 or ys.size == 0:
            return "unknown"

        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        bbox_h = max(1, y1 - y0)
        bbox_w = max(1, x1 - x0)
        torso_y0 = y0 + int(bbox_h * 0.58)
        torso_y1 = y0 + int(bbox_h * 0.88)
        torso_rows = foreground[torso_y0:torso_y1]
        row_edges = []
        for row in torso_rows:
            columns = np.where(row)[0]
            if columns.size:
                row_edges.append((int(columns.min()), int(columns.max())))
        if not row_edges:
            return "unknown"

        body_left = int(np.median([edge[0] for edge in row_edges]))
        body_right = int(np.median([edge[1] for edge in row_edges]))
        margin = max(2, int(bbox_w * 0.025))
        xx = np.arange(w)[None, :]
        sleeve = foreground & ((xx < body_left - margin) | (xx > body_right + margin))
        sleeve_window = sleeve[y0:y1]
        row_coverage = sleeve_window.sum(axis=1) / max(1, bbox_w)
        visible_rows = np.where(row_coverage > 0.018)[0]
        if visible_rows.size == 0:
            return "short_sleeve"
        sleeve_bottom = int(visible_rows.max()) / max(1, bbox_h)
        lower_coverage = float(sleeve_window[int(bbox_h * 0.58) : int(bbox_h * 0.84)].mean())
        if sleeve_bottom < 0.52:
            return "short_sleeve"
        if sleeve_bottom < 0.68:
            return "rolled_sleeve"
        if lower_coverage <= 0.045:
            return "unknown"
        sleeve_rows = np.where(row_coverage > 0.035)[0]
        last_rows = row_coverage[max(0, int(sleeve_rows.max()) - 18) : sleeve_rows.max() + 1]
        forearm_rows = row_coverage[int(len(row_coverage) * 0.40) : int(len(row_coverage) * 0.72)]
        cuff_coverage = float(last_rows.mean()) if last_rows.size else 0.0
        forearm_coverage = float(forearm_rows.mean()) if forearm_rows.size else max(cuff_coverage, 1e-6)
        cuff_ratio = cuff_coverage / max(0.001, forearm_coverage)
        if sleeve_bottom > 0.82 and cuff_ratio < 0.45:
            return "folded_cuff"
        if sleeve_bottom > 0.72 and cuff_ratio > 1.10:
            return "folded_cuff"
        return "full_length"

    @staticmethod
    def _target_sleeve_bottom(style: str) -> float:
        if style == "folded_cuff":
            return 0.715
        if style == "rolled_sleeve":
            return 0.640
        return 0.755

    def _garment_coverage_score(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_palette = self._foreground_palette(garment)
        sleeve_style = self._sleeve_style(np.asarray(garment.convert("RGB")).astype(np.float32) / 255.0)
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        torso = (yy > h * 0.32) & (yy < h * 0.78) & (xx > w * 0.26) & (xx < w * 0.74)
        sleeve_bottom = 0.57 if sleeve_style == "short_sleeve" else 0.68 if sleeve_style == "rolled_sleeve" else 0.76
        left_sleeve = (yy > h * 0.36) & (yy < h * sleeve_bottom) & (xx > w * 0.10) & (xx < w * 0.34)
        right_sleeve = (yy > h * 0.36) & (yy < h * sleeve_bottom) & (xx > w * 0.66) & (xx < w * 0.90)
        region = torso | left_sleeve | right_sleeve
        if not region.any():
            return 0.45
        pixels = arr[region]
        color_distance = np.linalg.norm(pixels[:, None, :] - garment_palette[None, :, :], axis=2).min(axis=1)
        close = color_distance < 0.24
        coverage = float(close.mean())
        palette_similarity = 1.0 - min(1.0, float(np.median(color_distance)) * 1.8)
        return float(max(0.0, min(1.0, 0.75 * min(1.0, coverage * 1.45) + 0.25 * palette_similarity)))

    def _upper_body_preservation(self, person: Image.Image, candidate: Image.Image) -> float:
        person_arr = np.asarray(person.convert("RGB")).astype(np.float32) / 255.0
        candidate_arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = candidate_arr.shape[:2]
        region = np.zeros((h, w), dtype=bool)
        region[: int(h * 0.44), :] = True
        region[int(h * 0.44) : int(h * 0.62), : int(w * 0.18)] = True
        region[int(h * 0.44) : int(h * 0.62), int(w * 0.82) :] = True
        diff = np.abs(person_arr[region] - candidate_arr[region]).mean() if region.any() else 0.3
        edge_diff = abs(float(self._pose_edge_map(person)[region].mean()) - float(self._pose_edge_map(candidate)[region].mean())) if region.any() else 0.2
        return float(max(0.0, min(1.0, 1.0 - diff * 2.4 - edge_diff * 1.5)))

    def _shoe_preservation(
        self,
        person: Image.Image,
        candidate: Image.Image,
        region_mask: Image.Image | None = None,
    ) -> float:
        person_arr = np.asarray(person.convert("RGB")).astype(np.float32) / 255.0
        candidate_arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = candidate_arr.shape[:2]
        if region_mask is None:
            shoe = np.zeros((h, w), dtype=bool)
            shoe[int(h * 0.88) :, int(w * 0.20) : int(w * 0.80)] = True
        else:
            shoe = self._region_bool(region_mask, (w, h))
        diff = np.abs(person_arr[shoe] - candidate_arr[shoe]).mean() if shoe.any() else 0.25
        return float(max(0.0, min(1.0, 1.0 - diff * 2.2)))

    def _lower_pose_preservation(self, person: Image.Image, candidate: Image.Image) -> float:
        person_edges = self._pose_edge_map(person)
        candidate_edges = self._pose_edge_map(candidate)
        h, w = person_edges.shape
        region = np.zeros((h, w), dtype=bool)
        region[int(h * 0.48) : int(h * 0.90), int(w * 0.18) : int(w * 0.82)] = True
        p = person_edges[region]
        c = candidate_edges[region]
        if p.size == 0 or c.size == 0:
            return 0.55
        density_score = 1.0 - min(1.0, abs(float(p.mean()) - float(c.mean())) * 5.0)
        overlap = float((p & c).sum() / max(1, (p | c).sum()))
        row_score = 1.0 - min(1.0, float(np.abs(person_edges[region].mean() - candidate_edges[region].mean())) * 6.0)
        return float(max(0.0, min(1.0, 0.40 * density_score + 0.40 * overlap + 0.20 * row_score)))

    @classmethod
    def _waistband_alignment(
        cls,
        candidate: Image.Image,
        region_mask: Image.Image | None = None,
    ) -> float:
        edges = np.asarray(candidate.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        h, w = edges.shape
        if region_mask is None:
            band = edges[int(h * 0.43) : int(h * 0.55), int(w * 0.24) : int(w * 0.76)]
        else:
            band = cls._region_crop(edges, region_mask, (w, h))
        if band.size == 0:
            return 0.45
        row_profile = band.mean(axis=1)
        line_strength = float(row_profile.max()) if row_profile.size else 0.0
        continuity = float((band > 0.18).mean())
        return float(max(0.0, min(1.0, line_strength * 3.0 + continuity * 2.0)))

    @staticmethod
    def _single_leg_integrity(candidate: Image.Image, side: str) -> float:
        edges = np.asarray(candidate.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        h, w = edges.shape
        x0, x1 = (int(w * 0.22), int(w * 0.50)) if side == "left" else (int(w * 0.50), int(w * 0.78))
        leg = edges[int(h * 0.55) : int(h * 0.90), x0:x1]
        if leg.size == 0:
            return 0.35
        density = float((leg > 0.16).mean())
        row_presence = float(((leg > 0.16).mean(axis=1) > 0.025).mean())
        if density < 0.01:
            return 0.30
        if density > 0.42:
            return 0.45
        return float(max(0.0, min(1.0, 0.45 + row_presence * 0.45 + (1.0 - abs(density - 0.12) * 3.0) * 0.10)))

    @classmethod
    def _knee_preservation(cls, candidate: Image.Image, region_mask: Image.Image | None = None) -> float:
        edges = np.asarray(candidate.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        h, w = edges.shape
        knees = (
            edges[int(h * 0.64) : int(h * 0.75), int(w * 0.22) : int(w * 0.78)]
            if region_mask is None
            else edges[cls._region_bool(region_mask, (w, h))]
        )
        if knees.size == 0:
            return 0.45
        density = float((knees > 0.18).mean())
        return float(max(0.0, min(1.0, 1.0 - abs(density - 0.13) * 3.5)))

    @classmethod
    def _ankle_preservation(cls, candidate: Image.Image, region_mask: Image.Image | None = None) -> float:
        edges = np.asarray(candidate.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        h, w = edges.shape
        ankles = (
            edges[int(h * 0.82) : int(h * 0.92), int(w * 0.24) : int(w * 0.76)]
            if region_mask is None
            else edges[cls._region_bool(region_mask, (w, h))]
        )
        if ankles.size == 0:
            return 0.45
        density = float((ankles > 0.18).mean())
        return float(max(0.0, min(1.0, 1.0 - abs(density - 0.12) * 4.0)))

    def _lower_garment_coverage_score(self, garment: Image.Image, candidate: Image.Image) -> float:
        garment_color = np.median(self._foreground_pixels(garment), axis=0)
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        region = arr[int(h * 0.48) : int(h * 0.88), int(w * 0.22) : int(w * 0.78)]
        if region.size == 0:
            return 0.45
        color_distance = np.linalg.norm(region - garment_color, axis=2)
        close = color_distance < 0.31
        coverage = float(close.mean())
        mean_similarity = 1.0 - min(1.0, float(np.linalg.norm(np.median(region.reshape(-1, 3), axis=0) - garment_color)) * 1.4)
        return float(max(0.0, min(1.0, 0.70 * min(1.0, coverage * 1.7) + 0.30 * mean_similarity)))

    @classmethod
    def _lower_hem_alignment(
        cls,
        candidate: Image.Image,
        region_mask: Image.Image | None = None,
    ) -> float:
        edges = np.asarray(candidate.convert("L").filter(ImageFilter.FIND_EDGES)).astype(np.float32) / 255.0
        h, w = edges.shape
        hem = (
            edges[int(h * 0.80) : int(h * 0.92), int(w * 0.24) : int(w * 0.76)]
            if region_mask is None
            else cls._region_crop(edges, region_mask, (w, h))
        )
        if hem.size == 0:
            return 0.45
        row_profile = hem.mean(axis=1)
        return float(max(0.0, min(1.0, float(row_profile.max()) * 3.2)))

    @staticmethod
    def _lower_category_window(shape: tuple[int, int], category: str | None) -> np.ndarray:
        h, w = shape
        normalized = category or "pants"
        y0 = 0.38
        y1 = 0.76 if normalized == "shorts" else 0.88 if normalized == "skirt" else 0.95
        window = np.zeros((h, w), dtype=bool)
        window[int(h * y0) : int(h * y1), int(w * 0.16) : int(w * 0.84)] = True
        return window

    def _candidate_lower_garment_mask(
        self,
        garment: Image.Image,
        candidate: Image.Image,
        category: str | None,
    ) -> np.ndarray:
        palette = self._foreground_palette(garment)
        arr = np.asarray(candidate.convert("RGB"), dtype=np.float32) / 255.0
        distance = np.linalg.norm(
            arr[:, :, None, :] - palette[None, None, :, :], axis=3
        ).min(axis=2)
        window = self._lower_category_window(distance.shape, category)
        mask = (distance < 0.255) & window

        # Remove isolated color matches while retaining seams and narrow cuffs.
        neighbours = np.zeros_like(mask, dtype=np.uint8)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            neighbours += np.roll(mask, (dy, dx), axis=(0, 1))
        return mask & (neighbours >= 1)

    def _layered_garment_score(
        self,
        person: Image.Image,
        candidate: Image.Image,
        category: str | None,
        garment_mask: np.ndarray,
    ) -> float:
        person_arr = np.asarray(person.convert("RGB"), dtype=np.float32) / 255.0
        candidate_arr = np.asarray(candidate.convert("RGB"), dtype=np.float32) / 255.0
        expected = self._region_bool(
            build_lower_body_mask_for_category(candidate, category), candidate.size
        )
        if not expected.any():
            return 0.5
        changed = np.linalg.norm(candidate_arr - person_arr, axis=2) > 0.07
        replaced = changed | garment_mask
        return float(max(0.0, min(1.0, replaced[expected].mean() * 1.12)))

    def _revealed_leg_integrity(
        self,
        person: Image.Image,
        candidate: Image.Image,
        category: str | None,
    ) -> float:
        if category not in {"shorts", "skirt"}:
            return 1.0
        person_arr = np.asarray(person.convert("RGB"), dtype=np.float32) / 255.0
        candidate_arr = np.asarray(candidate.convert("RGB"), dtype=np.float32) / 255.0
        h, w = candidate_arr.shape[:2]
        arm_regions = np.concatenate(
            [
                person_arr[int(h * 0.30) : int(h * 0.62), int(w * 0.12) : int(w * 0.30)].reshape(-1, 3),
                person_arr[int(h * 0.30) : int(h * 0.62), int(w * 0.70) : int(w * 0.88)].reshape(-1, 3),
            ],
            axis=0,
        )
        if arm_regions.size == 0:
            return 0.5
        skin_palette = np.percentile(arm_regions, [35, 50, 65], axis=0)
        y0 = 0.64 if category == "shorts" else 0.76
        reveal = candidate_arr[int(h * y0) : int(h * 0.90), int(w * 0.20) : int(w * 0.80)]
        if reveal.size == 0:
            return 0.5
        distance = np.linalg.norm(
            reveal[:, :, None, :] - skin_palette[None, None, :, :], axis=3
        ).min(axis=2)
        skin_ratio = float((distance < 0.24).mean())
        return float(max(0.0, min(1.0, skin_ratio / 0.32)))

    @classmethod
    def _crotch_artifact_score(cls, candidate: Image.Image, region_mask: Image.Image | None = None) -> float:
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        region = (
            arr[int(h * 0.50) : int(h * 0.66), int(w * 0.38) : int(w * 0.62)]
            if region_mask is None
            else arr[cls._region_bool(region_mask, (w, h))]
        )
        if region.size == 0:
            return 0.50
        clipped = float(((region < 0.015) | (region > 0.985)).mean())
        texture = float(region.std())
        texture_score = 1.0 - min(1.0, abs(texture - 0.18) * 2.5)
        return float(max(0.0, min(1.0, texture_score - clipped * 2.0)))

    @staticmethod
    def _region_bool(mask: Image.Image, size: tuple[int, int]) -> np.ndarray:
        return np.asarray(mask.convert("L").resize(size, Image.Resampling.NEAREST)) > 127

    @classmethod
    def _region_crop(cls, values: np.ndarray, mask: Image.Image, size: tuple[int, int]) -> np.ndarray:
        region = cls._region_bool(mask, size)
        ys, xs = np.where(region)
        if not len(xs) or not len(ys):
            return values[0:0, 0:0]
        return values[int(ys.min()) : int(ys.max()) + 1, int(xs.min()) : int(xs.max()) + 1]

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
    def _rectangular_artifact_score(candidate: Image.Image) -> float:
        arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        h, w = arr.shape[:2]
        gray = arr.mean(axis=2)
        vertical_jump = np.abs(np.diff(gray, axis=1))
        horizontal_jump = np.abs(np.diff(gray, axis=0))
        x_profile = vertical_jump.mean(axis=0)
        y_profile = horizontal_jump.mean(axis=1)

        def profile_penalty(profile: np.ndarray) -> float:
            if profile.size == 0:
                return 0.0
            center = profile[int(profile.size * 0.08) : int(profile.size * 0.92)]
            if center.size == 0:
                return 0.0
            baseline = float(np.median(center)) + 1e-6
            threshold = baseline * 2.8 + 0.018
            strong = np.where(center > threshold)[0]
            if strong.size < 2:
                return 0.0
            span = int(strong.max() - strong.min())
            paired_edges = 1.0 if span > profile.size * 0.34 else 0.45
            strength = min(1.0, float((center[strong].mean() - threshold) / max(0.025, threshold)))
            return paired_edges * strength

        penalty = max(profile_penalty(x_profile), profile_penalty(y_profile))
        border_band = max(4, min(h, w) // 90)
        border_contrast = float(
            np.mean(
                [
                    vertical_jump[:, max(0, int(w * 0.12) - border_band) : int(w * 0.12) + border_band].mean(),
                    vertical_jump[:, max(0, int(w * 0.88) - border_band) : min(w - 1, int(w * 0.88) + border_band)].mean(),
                    horizontal_jump[max(0, int(h * 0.16) - border_band) : int(h * 0.16) + border_band, :].mean(),
                    horizontal_jump[max(0, int(h * 0.88) - border_band) : min(h - 1, int(h * 0.88) + border_band), :].mean(),
                ]
            )
        )
        penalty = max(penalty, min(1.0, max(0.0, border_contrast - 0.035) * 8.0))
        return float(max(0.0, min(1.0, 1.0 - penalty)))

    @staticmethod
    def _background_cast_score(person: Image.Image, garment: Image.Image, candidate: Image.Image) -> float:
        person_arr = np.asarray(person.convert("RGB")).astype(np.float32) / 255.0
        candidate_arr = np.asarray(candidate.convert("RGB")).astype(np.float32) / 255.0
        garment_color = np.median(TryOnScorer._foreground_pixels(garment), axis=0)
        h, w = candidate_arr.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        background_region = (yy < h * 0.18) | (xx < w * 0.10) | (xx > w * 0.90)
        if not background_region.any():
            return 0.85
        garment_chroma = TryOnScorer._normalized_color(garment_color)
        candidate_chroma = TryOnScorer._rgb_chroma_float(candidate_arr)
        person_chroma = TryOnScorer._rgb_chroma_float(person_arr)
        candidate_to_garment = np.linalg.norm(candidate_chroma - garment_chroma, axis=2)
        person_to_garment = np.linalg.norm(person_chroma - garment_chroma, axis=2)
        cast = (person_to_garment - candidate_to_garment)[background_region]
        cast_amount = float(np.maximum(0.0, cast).mean())
        return float(max(0.0, min(1.0, 1.0 - cast_amount * 8.0)))

    @staticmethod
    def _realism_score(candidate: Image.Image) -> float:
        gray = np.asarray(candidate.convert("L")).astype(np.float32) / 255.0
        mean = float(gray.mean())
        contrast = float(gray.std())
        exposure = 1.0 - min(1.0, abs(mean - 0.52) * 2.0)
        contrast_score = 1.0 - min(1.0, abs(contrast - 0.22) * 2.2)
        return float(max(0.0, min(1.0, 0.55 * exposure + 0.45 * contrast_score)))

    @staticmethod
    def _normalized_color(color: np.ndarray) -> np.ndarray:
        total = float(color.sum()) + 1e-6
        return color / total

    @staticmethod
    def _rgb_chroma_float(arr: np.ndarray) -> np.ndarray:
        total = arr.sum(axis=2, keepdims=True) + 1e-6
        return arr / total
