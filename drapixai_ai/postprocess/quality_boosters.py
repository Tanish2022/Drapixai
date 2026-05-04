from __future__ import annotations

from PIL import Image, ImageEnhance, ImageFilter, ImageStat

from drapixai_ai.configs.settings import settings


def apply_quality_boosters(
    image: Image.Image,
    *,
    person: Image.Image,
    garment: Image.Image,
) -> Image.Image:
    """Apply enabled post-generation quality boosters.

    FLUX-style refinement and dedicated upscaling are reserved extension points.
    The current implementation keeps them off by default and applies only a
    conservative detail polish when explicitly enabled.
    """

    result = image.convert("RGB")

    if settings.enable_refinement:
        result = _harmonize_luma(result, person)
        result = _restore_garment_color(result, garment)
        result = ImageEnhance.Contrast(result).enhance(1.015)

    if settings.enable_upscale:
        result = _detail_restore(result)

    return result


def _mean_luma(image: Image.Image) -> float:
    return float(ImageStat.Stat(image.convert("L")).mean[0])


def _harmonize_luma(image: Image.Image, person: Image.Image) -> Image.Image:
    target = _mean_luma(person)
    current = _mean_luma(image)
    if current <= 1:
        return image
    factor = max(0.94, min(1.06, target / current))
    return ImageEnhance.Brightness(image).enhance(factor)


def _restore_garment_color(image: Image.Image, garment: Image.Image) -> Image.Image:
    garment_color = ImageStat.Stat(garment.convert("RGB")).mean
    result_color = ImageStat.Stat(image.convert("RGB")).mean
    garment_saturation = max(garment_color) - min(garment_color)
    result_saturation = max(result_color) - min(result_color)
    if result_saturation >= garment_saturation * 0.85:
        return ImageEnhance.Color(image).enhance(1.02)
    return ImageEnhance.Color(image).enhance(1.05)


def _detail_restore(image: Image.Image) -> Image.Image:
    sharpened = image.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=4))
    return sharpened.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=5))
