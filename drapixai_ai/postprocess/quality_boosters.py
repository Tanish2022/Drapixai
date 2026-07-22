from __future__ import annotations

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter, ImageStat

from drapixai_ai.configs.settings import settings
from drapixai_ai.preprocess.garment_analyzer import isolate_garment
from drapixai_ai.preprocess.mask_builder import build_lower_body_mask_for_category


def apply_quality_boosters(
    image: Image.Image,
    *,
    person: Image.Image,
    garment: Image.Image,
    garment_type: str | None = None,
    tryon_mask: Image.Image | None = None,
) -> Image.Image:
    """Apply enabled post-generation quality boosters.

    FLUX-style refinement and dedicated upscaling are reserved extension points.
    The current implementation keeps them off by default and applies only a
    conservative detail polish when explicitly enabled.
    """

    result = image.convert("RGB")
    person_resized = person.convert("RGB").resize(result.size, Image.Resampling.LANCZOS)
    lower_category = _lower_category(garment_type)
    lower_region = (
        _build_lower_postprocess_mask(person_resized, lower_category, tryon_mask)
        if lower_category is not None
        else None
    )

    if settings.enable_garment_color_fix:
        result = _match_garment_color(
            result,
            garment,
            region_mask=lower_region,
            strength=(settings.lower_body_color_fix_strength if lower_region is not None else None),
        )

    if settings.enable_natural_lighting_fix:
        lit = _naturalize_lighting(result, person_resized if lower_region is not None else person)
        result = _composite_region(result, lit, lower_region)

    if lower_region is None:
        result = _protect_background_color(result, person_resized, garment)

    if settings.enable_fashion_polish:
        result = _apply_fashion_polish(result, garment, region_mask=lower_region)

    if lower_region is not None:
        result = _restore_fabric_detail(result, garment, lower_region)

    if lower_region is None and settings.enable_person_context_restore:
        result = _restore_person_context(result, person, garment)

    if settings.enable_refinement:
        refined = _harmonize_luma(result, person_resized if lower_region is not None else person)
        refined = _restore_garment_saturation(refined, garment)
        refined = ImageEnhance.Contrast(refined).enhance(1.015)
        result = _composite_region(result, refined, lower_region)

    if settings.enable_upscale:
        result = _composite_region(result, _detail_restore(result), lower_region)

    if lower_region is not None and settings.lower_body_restore_context:
        result = Image.composite(result, person_resized, lower_region)

    return result


def _lower_category(garment_type: str | None) -> str | None:
    normalized = (garment_type or "").strip().lower().replace("-", "_")
    if ":" in normalized:
        garment_family, category = normalized.split(":", 1)
        return category if garment_family in {"lower", "lower_body"} else None
    if normalized in {"jeans", "pants", "trousers", "shorts", "skirt", "leggings", "joggers"}:
        return normalized
    if normalized in {"lower", "lower_body"}:
        return "pants"
    return None


def _build_lower_postprocess_mask(
    person: Image.Image,
    category: str,
    tryon_mask: Image.Image | None,
) -> Image.Image:
    category_mask = build_lower_body_mask_for_category(person, category).convert("L")
    if tryon_mask is not None:
        engine_mask = tryon_mask.convert("L").resize(person.size, Image.Resampling.LANCZOS)
        category_mask = ImageChops.darker(category_mask, engine_mask)

    inset = max(0, settings.lower_body_postprocess_mask_inset)
    if inset:
        filter_size = inset * 2 + 1
        category_mask = category_mask.filter(ImageFilter.MinFilter(size=filter_size))
    feather = max(0, settings.lower_body_postprocess_feather)
    if feather:
        category_mask = category_mask.filter(ImageFilter.GaussianBlur(radius=feather))
    return category_mask


def _composite_region(base: Image.Image, effect: Image.Image, region_mask: Image.Image | None) -> Image.Image:
    if region_mask is None:
        return effect
    return Image.composite(effect.convert("RGB"), base.convert("RGB"), region_mask)


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


def _naturalize_lighting(image: Image.Image, person: Image.Image) -> Image.Image:
    strength = max(0.0, min(1.0, settings.natural_lighting_strength))
    if strength <= 0:
        return image

    result = image.convert("RGB")
    person_resized = person.convert("RGB").resize(result.size, Image.BICUBIC)
    current_luma = _mean_luma(result)
    target_luma = _mean_luma(person_resized)
    if current_luma > 1:
        factor = 1.0 + ((target_luma - current_luma) / 255.0) * 0.20 * strength
        result = ImageEnhance.Brightness(result).enhance(max(0.965, min(1.03, factor)))

    result = ImageEnhance.Color(result).enhance(1.0)
    result = ImageEnhance.Contrast(result).enhance(1.0 + 0.045 * strength)
    sharpened = result.filter(
        ImageFilter.UnsharpMask(
            radius=1.05,
            percent=int(35 + 30 * strength),
            threshold=4,
        )
    )
    return Image.blend(result, sharpened, 0.28 * strength)


def _match_garment_color(
    image: Image.Image,
    garment: Image.Image,
    *,
    region_mask: Image.Image | None = None,
    strength: float | None = None,
) -> Image.Image:
    lower_mode = region_mask is not None
    garment_pixels = _garment_foreground_pixels(garment, preserve_neutral=lower_mode)
    if garment_pixels.size == 0:
        return image

    arr = np.asarray(image.convert("RGB")).astype(np.float32)
    garment_stats = (
        _sample_pixels(garment_pixels.astype(np.float32))
        if lower_mode
        else garment_pixels.astype(np.float32)
    )
    target = np.median(garment_stats, axis=0)
    mask = _generated_garment_mask(arr, target, region_mask=region_mask)
    if float(mask.mean()) < 0.035:
        return image

    source_pixels = arr[mask]
    source_stats = _sample_pixels(source_pixels) if lower_mode else source_pixels
    source = np.median(source_stats, axis=0)
    correction_strength = settings.garment_color_fix_strength if strength is None else strength
    correction_strength = max(0.0, min(0.98, correction_strength))
    corrected = arr.copy()

    # Preserve generated lighting/texture by applying a bounded garment-level
    # color and contrast correction instead of repainting each pixel flat.
    target_p10 = np.percentile(garment_stats, 10, axis=0)
    target_p90 = np.percentile(garment_stats, 90, axis=0)
    source_p10 = np.percentile(source_stats, 10, axis=0)
    source_p90 = np.percentile(source_stats, 90, axis=0)
    source_range = np.maximum(12.0, source_p90 - source_p10)
    target_range = np.maximum(12.0, target_p90 - target_p10)
    gain_bounds = (0.90, 1.10) if lower_mode else (0.82, 1.22)
    delta_limit = 36.0 if lower_mode else 48.0
    gain = np.clip(target_range / source_range, *gain_bounds)
    rgb_delta = np.clip(target - source, -delta_limit, delta_limit)
    adjusted = (
        (corrected[mask] - source) * (1.0 + (gain - 1.0) * correction_strength)
        + source
        + rgb_delta * correction_strength
    )
    corrected[mask] = adjusted

    alpha = Image.fromarray((mask.astype(np.uint8) * 255), mode="L")
    if settings.garment_color_fix_edge_guard:
        alpha = alpha.filter(ImageFilter.MinFilter(size=5)).filter(ImageFilter.GaussianBlur(radius=4))
    else:
        alpha = alpha.filter(ImageFilter.GaussianBlur(radius=10))
    corrected_img = Image.fromarray(np.clip(corrected, 0, 255).astype(np.uint8), mode="RGB")
    return Image.composite(corrected_img, image.convert("RGB"), alpha)


def _protect_background_color(image: Image.Image, person: Image.Image, garment: Image.Image) -> Image.Image:
    result = image.convert("RGB")
    person_resized = person.convert("RGB").resize(result.size, Image.BICUBIC)
    result_arr = np.asarray(result).astype(np.float32)
    person_arr = np.asarray(person_resized).astype(np.float32)
    garment_pixels = _garment_foreground_pixels(garment, preserve_neutral=region_mask is not None)
    if garment_pixels.size == 0:
        return result

    target = np.median(garment_pixels.astype(np.float32), axis=0)
    garment_mask = _generated_garment_mask(result_arr, target)
    h, w = garment_mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    subject_region = (
        (yy > h * 0.14)
        & (yy < h * 0.90)
        & (xx > w * 0.04)
        & (xx < w * 0.96)
    )
    background_region = ~subject_region
    background_region |= (yy < h * 0.16)
    background_region |= ((xx < w * 0.08) | (xx > w * 0.92))
    background_region &= ~garment_mask
    if float(background_region.mean()) < 0.08:
        return result

    garment_chroma = _rgb_chroma(target.reshape(1, 1, 3))[0, 0]
    result_chroma = _rgb_chroma(result_arr)
    chroma_cast = np.linalg.norm(result_chroma - garment_chroma, axis=2)
    cast_region = background_region & (chroma_cast < settings.background_color_cast_threshold)
    if float(cast_region.mean()) < 0.006:
        return result

    alpha = Image.fromarray((cast_region.astype(np.uint8) * 255), mode="L")
    alpha = alpha.filter(ImageFilter.MaxFilter(size=7)).filter(ImageFilter.GaussianBlur(radius=5))
    alpha_arr = (np.asarray(alpha).astype(np.float32) / 255.0)[:, :, None] * 0.82
    restored = result_arr * (1.0 - alpha_arr) + person_arr * alpha_arr
    return Image.fromarray(np.clip(restored, 0, 255).astype(np.uint8), mode="RGB")


def _apply_fashion_polish(
    image: Image.Image,
    garment: Image.Image,
    *,
    region_mask: Image.Image | None = None,
) -> Image.Image:
    strength = max(0.0, min(1.0, settings.fashion_polish_strength))
    if strength <= 0:
        return image

    arr = np.asarray(image.convert("RGB")).astype(np.float32)
    garment_pixels = _garment_foreground_pixels(garment)
    if garment_pixels.size == 0:
        return image

    target = np.median(garment_pixels.astype(np.float32), axis=0)
    garment_mask = _generated_garment_mask(arr, target, region_mask=region_mask)
    if float(garment_mask.mean()) < 0.035:
        return image

    polished = _restore_micro_fabric_texture(arr, garment_mask, strength)
    polished = _add_hem_contact_shadow(polished, garment_mask, strength)
    polished = _soften_button_sharpness(polished, garment_mask, strength)
    return Image.fromarray(np.clip(polished, 0, 255).astype(np.uint8), mode="RGB")


def _restore_micro_fabric_texture(arr: np.ndarray, garment_mask: np.ndarray, strength: float) -> np.ndarray:
    gray = arr.mean(axis=2)
    fine = gray - _box_blur_gray(gray, radius=4)
    fine = np.clip(fine, -10.0, 10.0)
    texture = fine[:, :, None] * (0.10 + 0.10 * strength)

    h, w = garment_mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    torso = garment_mask & (yy > h * 0.25) & (yy < h * 0.75) & (xx > w * 0.20) & (xx < w * 0.80)
    alpha = Image.fromarray((torso.astype(np.uint8) * 255), mode="L").filter(ImageFilter.GaussianBlur(radius=6))
    alpha_arr = (np.asarray(alpha).astype(np.float32) / 255.0)[:, :, None]
    return arr + texture * alpha_arr


def _add_hem_contact_shadow(arr: np.ndarray, garment_mask: np.ndarray, strength: float) -> np.ndarray:
    h, w = garment_mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    center = (xx > w * 0.25) & (xx < w * 0.75)
    lower = garment_mask & center & (yy > h * 0.55) & (yy < h * 0.84)
    row_coverage = lower.mean(axis=1)
    rows = np.where(row_coverage > 0.16)[0]
    if rows.size == 0:
        return arr

    bottom = int(rows.max())
    band_top = min(h - 1, bottom + 1)
    band_bottom = min(h, bottom + max(3, int(h * 0.018)))
    if band_bottom <= band_top:
        return arr

    band = np.zeros((h, w), dtype=np.float32)
    band[band_top:band_bottom, int(w * 0.30) : int(w * 0.70)] = 1.0
    alpha = Image.fromarray((band * 255).astype(np.uint8), mode="L").filter(ImageFilter.GaussianBlur(radius=5))
    alpha_arr = (np.asarray(alpha).astype(np.float32) / 255.0)[:, :, None]
    shadow = 1.0 - alpha_arr * (0.035 + 0.035 * strength)
    return arr * shadow


def _soften_button_sharpness(arr: np.ndarray, garment_mask: np.ndarray, strength: float) -> np.ndarray:
    h, w = garment_mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    placket = garment_mask & (xx > w * 0.43) & (xx < w * 0.57) & (yy > h * 0.24) & (yy < h * 0.76)
    dark_detail = arr.mean(axis=2) < 82
    button_mask = placket & dark_detail
    if float(button_mask.mean()) < 0.0002:
        return arr

    alpha = Image.fromarray((button_mask.astype(np.uint8) * 255), mode="L").filter(ImageFilter.GaussianBlur(radius=1.4))
    alpha_arr = (np.asarray(alpha).astype(np.float32) / 255.0)[:, :, None] * (0.18 + 0.14 * strength)
    softened = np.asarray(
        Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB").filter(ImageFilter.GaussianBlur(radius=0.55))
    ).astype(np.float32)
    return arr * (1.0 - alpha_arr) + softened * alpha_arr


def _restore_person_context(image: Image.Image, person: Image.Image, garment: Image.Image) -> Image.Image:
    strength = max(0.0, min(1.0, settings.person_context_restore_strength))
    if strength <= 0:
        return image

    result = image.convert("RGB")
    person_resized = person.convert("RGB").resize(result.size, Image.BICUBIC)
    result_arr = np.asarray(result).astype(np.float32)
    person_arr = np.asarray(person_resized).astype(np.float32)
    garment_pixels = _garment_foreground_pixels(garment)
    if garment_pixels.size == 0:
        return result

    target = np.median(garment_pixels.astype(np.float32), axis=0)
    garment_mask = _generated_garment_mask(result_arr, target)
    h, w = garment_mask.shape
    yy, xx = np.mgrid[0:h, 0:w]
    torso_region = (yy > h * 0.28) & (yy < h * 0.88) & (xx > w * 0.12) & (xx < w * 0.88)
    left_sleeve_region = (yy > h * 0.30) & (yy < h * 0.82) & (xx > w * 0.02) & (xx < w * 0.38)
    right_sleeve_region = (yy > h * 0.30) & (yy < h * 0.82) & (xx > w * 0.62) & (xx < w * 0.98)
    collar_region = (
        (yy > h * 0.24)
        & (yy < h * 0.40)
        & (xx > w * 0.30)
        & (xx < w * 0.70)
        & ~((yy < h * 0.32) & (xx > w * 0.40) & (xx < w * 0.60))
    )
    garment_region = torso_region | left_sleeve_region | right_sleeve_region | collar_region
    keep_generated = garment_region | (garment_mask & (yy > h * 0.30))

    mask = Image.fromarray((keep_generated.astype(np.uint8) * 255), mode="L")
    mask = mask.filter(ImageFilter.MaxFilter(size=9)).filter(ImageFilter.GaussianBlur(radius=7))
    mask_arr = (np.asarray(mask).astype(np.float32) / 255.0)[:, :, None]
    context_restored = person_arr * (1.0 - mask_arr) + result_arr * mask_arr
    restored = result_arr * (1.0 - strength) + context_restored * strength
    return Image.fromarray(np.clip(restored, 0, 255).astype(np.uint8), mode="RGB")


def _restore_fabric_detail(image: Image.Image, garment: Image.Image, region_mask: Image.Image) -> Image.Image:
    garment_pixels = _garment_foreground_pixels(garment, preserve_neutral=True)
    if garment_pixels.size == 0:
        return image

    garment_gray = np.mean(_sample_pixels(garment_pixels.astype(np.float32)), axis=1)
    target_detail = float(np.std(garment_gray))
    if target_detail < 8.0:
        return image

    region = np.asarray(region_mask.convert("L"), dtype=np.float32) / 255.0
    source_gray = np.asarray(image.convert("L"), dtype=np.float32)
    core = region > 0.70
    if not core.any():
        return image
    local_detail = source_gray - _box_blur_gray(source_gray, radius=2)
    current_detail = float(np.std(local_detail[core]))
    if current_detail >= min(18.0, target_detail * 0.35):
        return image

    deficit = max(0.0, min(1.0, (target_detail * 0.35 - current_detail) / max(4.0, target_detail * 0.35)))
    sharpened = image.convert("RGB").filter(
        ImageFilter.UnsharpMask(radius=0.85, percent=int(35 + 55 * deficit), threshold=3)
    )
    detail_mask = region_mask.filter(ImageFilter.MinFilter(size=3)).filter(ImageFilter.GaussianBlur(radius=2))
    return Image.composite(sharpened, image.convert("RGB"), detail_mask)


def _box_blur_gray(gray: np.ndarray, radius: int) -> np.ndarray:
    image = Image.fromarray(np.clip(gray, 0, 255).astype(np.uint8), mode="L").filter(
        ImageFilter.BoxBlur(radius)
    )
    return np.asarray(image).astype(np.float32)


def _sample_pixels(pixels: np.ndarray, maximum: int = 50_000) -> np.ndarray:
    if len(pixels) <= maximum:
        return pixels
    indices = np.linspace(0, len(pixels) - 1, maximum, dtype=np.int64)
    return pixels[indices]


def _garment_foreground_pixels(garment: Image.Image, *, preserve_neutral: bool = False) -> np.ndarray:
    rgba = isolate_garment(garment)
    arr = np.asarray(rgba.convert("RGBA"))
    alpha = arr[:, :, 3] > 16
    rgb = arr[:, :, :3]
    if preserve_neutral:
        foreground = alpha
        if float(alpha.mean()) > 0.92:
            corners = np.concatenate(
                [
                    rgb[:24, :24].reshape(-1, 3),
                    rgb[:24, -24:].reshape(-1, 3),
                    rgb[-24:, :24].reshape(-1, 3),
                    rgb[-24:, -24:].reshape(-1, 3),
                ],
                axis=0,
            ).astype(np.float32)
            background = np.median(corners, axis=0)
            foreground &= np.linalg.norm(rgb.astype(np.float32) - background, axis=2) > 10.0
    else:
        foreground = alpha & (rgb.mean(axis=2) < 245)
    pixels = rgb[foreground]
    if pixels.size == 0:
        return np.empty((0, 3), dtype=np.uint8)
    return pixels


def _generated_garment_mask(
    arr: np.ndarray,
    target: np.ndarray,
    *,
    region_mask: Image.Image | None = None,
) -> np.ndarray:
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    if region_mask is None:
        body_region = (yy > h * 0.18) & (yy < h * 0.86) & (xx > w * 0.08) & (xx < w * 0.92)
    else:
        body_region = np.asarray(
            region_mask.convert("L").resize((w, h), Image.Resampling.LANCZOS),
            dtype=np.float32,
        ) > 96.0

    chroma = _rgb_chroma(arr)
    target_chroma = _rgb_chroma(target.reshape(1, 1, 3))[0, 0]
    chroma_distance = np.linalg.norm(chroma - target_chroma, axis=2)
    brightness = arr.mean(axis=2)
    saturation = arr.max(axis=2) - arr.min(axis=2)
    red = arr[:, :, 0]
    green = arr[:, :, 1]
    blue = arr[:, :, 2]
    skin_like = (
        (red > green * 1.04)
        & (red > blue * 1.14)
        & (green > blue * 0.92)
        & (brightness > 68)
        & (brightness < 226)
    )

    neutral_match = np.linalg.norm(arr - target.reshape(1, 1, 3), axis=2) < 72.0
    saturation_match = (saturation > 8) | neutral_match if region_mask is not None else saturation > 12
    return (
        body_region
        & ~skin_like
        & (chroma_distance < 0.26)
        & (brightness > 38)
        & (brightness < 235)
        & saturation_match
    )


def _rgb_chroma(arr: np.ndarray) -> np.ndarray:
    total = arr.sum(axis=2, keepdims=True) + 1e-6
    return arr / total


def _detail_restore(image: Image.Image) -> Image.Image:
    sharpened = image.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=4))
    return sharpened.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=5))
