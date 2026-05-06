from __future__ import annotations

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageStat

from drapixai_ai.configs.settings import settings
from drapixai_ai.preprocess.garment_analyzer import isolate_garment


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

    if settings.enable_garment_color_fix:
        result = _match_garment_color(result, garment)

    if settings.enable_refinement:
        result = _harmonize_luma(result, person)
        result = _restore_garment_saturation(result, garment)
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


def _restore_garment_saturation(image: Image.Image, garment: Image.Image) -> Image.Image:
    garment_color = ImageStat.Stat(garment.convert("RGB")).mean
    result_color = ImageStat.Stat(image.convert("RGB")).mean
    garment_saturation = max(garment_color) - min(garment_color)
    result_saturation = max(result_color) - min(result_color)
    if result_saturation >= garment_saturation * 0.85:
        return ImageEnhance.Color(image).enhance(1.02)
    return ImageEnhance.Color(image).enhance(1.05)


def _match_garment_color(image: Image.Image, garment: Image.Image) -> Image.Image:
    garment_pixels = _garment_foreground_pixels(garment)
    if garment_pixels.size == 0:
        return image

    arr = np.asarray(image.convert("RGB")).astype(np.float32)
    target = np.median(garment_pixels.astype(np.float32), axis=0)
    mask = _generated_garment_mask(arr, target)
    if float(mask.mean()) < 0.035:
        return image

    source = np.median(arr[mask], axis=0)
    strength = max(0.0, min(0.90, settings.garment_color_fix_strength))
    corrected = arr.copy()

    # Preserve generated lighting/texture by applying a bounded garment-level
    # color offset instead of repainting each pixel to a flat product color.
    rgb_delta = np.clip(target - source, -28.0, 28.0)
    corrected[mask] = corrected[mask] + rgb_delta * strength

    alpha = Image.fromarray((mask.astype(np.uint8) * 255), mode="L").filter(ImageFilter.GaussianBlur(radius=10))
    corrected_img = Image.fromarray(np.clip(corrected, 0, 255).astype(np.uint8), mode="RGB")
    return Image.composite(corrected_img, image.convert("RGB"), alpha)


def _garment_foreground_pixels(garment: Image.Image) -> np.ndarray:
    rgba = isolate_garment(garment)
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3] > 16
    rgb = arr[:, :, :3]
    foreground = alpha & (rgb.mean(axis=2) < 245)
    pixels = rgb[foreground]
    if pixels.size == 0:
        return np.empty((0, 3), dtype=np.uint8)
    return pixels


def _generated_garment_mask(arr: np.ndarray, target: np.ndarray) -> np.ndarray:
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    body_region = (yy > h * 0.18) & (yy < h * 0.86) & (xx > w * 0.08) & (xx < w * 0.92)
    face_region = (((xx - w * 0.50) / max(1.0, w * 0.23)) ** 2 + ((yy - h * 0.20) / max(1.0, h * 0.17)) ** 2) < 1.0
    lower_center = (yy > h * 0.80) & (xx > w * 0.30) & (xx < w * 0.70)

    chroma = _rgb_chroma(arr)
    target_chroma = _rgb_chroma(target.reshape(1, 1, 3))[0, 0]
    chroma_distance = np.linalg.norm(chroma - target_chroma, axis=2)
    brightness = arr.mean(axis=2)
    saturation = arr.max(axis=2) - arr.min(axis=2)

    return (
        body_region
        & ~face_region
        & ~lower_center
        & (chroma_distance < 0.26)
        & (brightness > 38)
        & (brightness < 235)
        & (saturation > 12)
    )


def _rgb_chroma(arr: np.ndarray) -> np.ndarray:
    total = arr.sum(axis=2, keepdims=True) + 1e-6
    return arr / total


def _detail_restore(image: Image.Image) -> Image.Image:
    sharpened = image.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=4))
    return sharpened.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=5))
