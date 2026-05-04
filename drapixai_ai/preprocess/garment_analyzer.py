from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class GarmentAnalysis:
    width: int
    height: int
    foreground_ratio: float
    dominant_color: tuple[int, int, int]
    warnings: list[str] = field(default_factory=list)


def analyze_garment(image: Image.Image) -> GarmentAnalysis:
    rgba = image.convert("RGBA")
    arr = np.asarray(rgba)
    alpha = arr[:, :, 3]
    foreground = alpha > 16
    foreground_ratio = float(foreground.mean())
    pixels = arr[:, :, :3][foreground] if foreground.any() else arr[:, :, :3].reshape(-1, 3)
    dominant = tuple(int(v) for v in pixels.mean(axis=0))

    warnings: list[str] = []
    if min(image.size) < 384:
        warnings.append("GARMENT_LOW_RESOLUTION")
    if foreground_ratio < 0.08:
        warnings.append("GARMENT_SUBJECT_TOO_SMALL")
    if foreground_ratio > 0.90:
        warnings.append("GARMENT_BACKGROUND_DOMINANT")

    return GarmentAnalysis(
        width=image.width,
        height=image.height,
        foreground_ratio=foreground_ratio,
        dominant_color=dominant,
        warnings=warnings,
    )
