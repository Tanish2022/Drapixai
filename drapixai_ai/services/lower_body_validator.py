from __future__ import annotations

import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter


@dataclass(frozen=True)
class LowerBodyValidation:
    ok: bool
    reason: str = "OK"
    warnings: tuple[str, ...] = field(default_factory=tuple)
    width: int = 0
    height: int = 0


def validate_lower_body_person(image_bytes: bytes) -> LowerBodyValidation:
    """Lightweight lower-body gate for the future beta path.

    This intentionally avoids adding a hard dependency on pose estimation. It is
    a conservative first pass; production beta should replace or augment it with
    pose/keypoint checks before public release.
    """

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        return LowerBodyValidation(ok=False, reason="INVALID_IMAGE")

    width, height = image.size
    if width <= 0 or height <= 0:
        return LowerBodyValidation(ok=False, reason="INVALID_DIMENSIONS")
    if min(width, height) < 512:
        return LowerBodyValidation(ok=False, reason="PERSON_IMAGE_TOO_SMALL", width=width, height=height)
    if height / max(1, width) < 1.15:
        return LowerBodyValidation(ok=False, reason="FULL_BODY_REQUIRED", width=width, height=height)

    rgb = np.asarray(image, dtype=np.float32)
    arr = np.asarray(image.convert("L"), dtype=np.float32)
    edges = np.asarray(image.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    lower = edges[int(height * 0.42) : int(height * 0.94), :]
    ankle_band = edges[int(height * 0.82) : int(height * 0.95), :]
    waist_band = edges[int(height * 0.40) : int(height * 0.56), :]
    if lower.size == 0 or float(lower.mean()) < 1.5:
        return LowerBodyValidation(ok=False, reason="LOWER_BODY_NOT_VISIBLE", width=width, height=height)
    if ankle_band.size == 0 or float(ankle_band.mean()) < 1.0:
        return LowerBodyValidation(ok=False, reason="ANKLES_NOT_VISIBLE", width=width, height=height)
    if waist_band.size == 0 or float(waist_band.mean()) < 1.5:
        return LowerBodyValidation(ok=False, reason="WAIST_NOT_VISIBLE", width=width, height=height)

    bottom = rgb[int(height * 0.975) :, :, :]
    side_width = max(1, int(width * 0.12))
    center_left = int(width * 0.28)
    center_right = int(width * 0.72)
    side_pixels = np.concatenate((bottom[:, :side_width, :], bottom[:, -side_width:, :]), axis=1)
    center_pixels = bottom[:, center_left:center_right, :]
    if side_pixels.size and center_pixels.size:
        background = np.median(side_pixels.reshape(-1, 3), axis=0)
        center_distance = np.linalg.norm(center_pixels - background, axis=2)
        center_median = np.median(center_pixels.reshape(-1, 3), axis=0)
        median_distance = float(np.linalg.norm(center_median - background))
        foreground_ratio = float((center_distance > 24.0).mean())
        if median_distance > 28.0 and foreground_ratio > 0.35:
            return LowerBodyValidation(ok=False, reason="LOWER_BODY_CROPPED", width=width, height=height)

    warnings: list[str] = []
    if float(lower.mean()) < 4.0 or float(ankle_band.mean()) < 3.0:
        warnings.append("LOW_DETAIL_LOWER_BODY")
    lower_luma = arr[int(height * 0.42) : int(height * 0.94), :]
    if lower_luma.size and float(lower_luma.std()) < 18.0:
        warnings.append("LOW_CONTRAST_LOWER_BODY")
    if width / max(1, height) > 0.82:
        warnings.append("PERSON_FRAMING_WIDE")

    return LowerBodyValidation(ok=True, warnings=tuple(warnings), width=width, height=height)
