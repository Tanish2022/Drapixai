from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from drapixai_ai.quality.tryon_scorer import TryOnScorer


def _product(color: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (384, 512), "white")
    draw = ImageDraw.Draw(image)
    draw.polygon(
        [(112, 100), (58, 152), (92, 230), (124, 202), (124, 430), (260, 430), (260, 202), (292, 230), (326, 152), (272, 100)],
        fill=color,
    )
    return image


def _candidate(color: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (384, 512), (222, 224, 228))
    draw = ImageDraw.Draw(image)
    draw.polygon(
        [(132, 130), (72, 170), (98, 246), (126, 224), (126, 408), (258, 408), (258, 224), (286, 246), (312, 170), (252, 130)],
        fill=color,
    )
    draw.rectangle((126, 380, 258, 408), fill=tuple(max(0, channel - 8) for channel in color))
    return image


def _assert_neutral_garment(color: tuple[int, int, int], label: str) -> None:
    scorer = TryOnScorer()
    garment = _product(color)
    candidate = _candidate(color)
    pixels = scorer._foreground_pixels(garment)
    median = np.median(pixels, axis=0)
    expected = np.asarray(color, dtype=np.float32) / 255.0
    if float(np.linalg.norm(median - expected)) > 0.12:
        raise AssertionError(f"{label} foreground followed the canvas instead of the fabric: {median}")
    coverage = scorer._garment_coverage_score(garment, candidate)
    hem = scorer._untucked_hem_presence(garment, candidate)
    if coverage < 0.72:
        raise AssertionError(f"{label} coverage falsely failed: {coverage:.3f}")
    if hem < 0.42:
        raise AssertionError(f"{label} untucked hem falsely failed: {hem:.3f}")


def main() -> None:
    _assert_neutral_garment((18, 18, 18), "black")
    _assert_neutral_garment((238, 238, 238), "off-white")
    print("Neutral-garment scorer validation passed.")


if __name__ == "__main__":
    main()
