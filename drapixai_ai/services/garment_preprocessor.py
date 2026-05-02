from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Tuple

import numpy as np
from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.services.garment_rules import GarmentRule, resolve_garment_rule
from drapixai_ai.services.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class GarmentPreprocessOptions:
    garment_profile: str | None = None
    category_hint: str | None = None
    product_name: str | None = None
    garment_id: str | None = None


@dataclass(frozen=True)
class GarmentPreprocessResult:
    image: Image.Image
    did_process: bool
    reason: str
    profile_key: str
    profile_label: str
    support_level: str
    warnings: tuple[str, ...] = ()


class GarmentValidationError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _has_sufficient_resolution(image: Image.Image, rule: GarmentRule) -> bool:
    return image.width >= rule.min_width and image.height >= rule.min_height


def _alpha_transparency_ratio(image: Image.Image) -> float:
    if image.mode not in ("RGBA", "LA"):
        return 0.0
    alpha = np.asarray(image.getchannel("A"))
    transparent = (alpha <= settings.garment_alpha_threshold).mean()
    return float(transparent)


def _is_clean_transparent(image: Image.Image) -> bool:
    if image.mode not in ("RGBA", "LA"):
        return False
    return _alpha_transparency_ratio(image) >= settings.garment_transparent_ratio


def _remove_background(image: Image.Image) -> Image.Image:
    try:
        from rembg import remove  # type: ignore
    except Exception as exc:
        logger.warning("rembg_unavailable", extra={"error": str(exc)})
        return image.convert("RGBA")

    return remove(image)


def _foreground_ratio(image: Image.Image) -> float:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    fg = (alpha > settings.garment_alpha_threshold).mean()
    return float(fg)


def _foreground_bbox(image: Image.Image) -> Tuple[int, int, int, int] | None:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > settings.garment_alpha_threshold)
    if len(xs) == 0 or len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _skin_mask(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    max_rgb = np.maximum(np.maximum(r, g), b)
    min_rgb = np.minimum(np.minimum(r, g), b)

    return (
        (r > 95)
        & (g > 40)
        & (b > 20)
        & ((max_rgb - min_rgb) > 15)
        & (np.abs(r - g) > 15)
        & (r > g)
        & (r > b)
    )


def _skin_ratios(image: Image.Image) -> Tuple[float, float]:
    rgba = image.convert("RGBA")
    rgb = np.asarray(rgba.convert("RGB"))
    alpha = np.asarray(rgba.getchannel("A")) > settings.garment_alpha_threshold
    if not alpha.any():
        return 0.0, 0.0

    skin = _skin_mask(rgb) & alpha
    total_skin_ratio = float(skin.sum() / alpha.sum())

    bbox = _foreground_bbox(rgba)
    if bbox is None:
        return total_skin_ratio, 0.0
    _x0, y0, _x1, y1 = bbox
    crop_h = max(1, y1 - y0 + 1)
    top_end = min(rgba.height, y0 + max(1, int(crop_h * 0.35)))
    top_alpha = alpha[y0:top_end, :]
    if not top_alpha.any():
        return total_skin_ratio, 0.0
    top_skin = skin[y0:top_end, :]
    top_skin_ratio = float(top_skin.sum() / top_alpha.sum())
    return total_skin_ratio, top_skin_ratio


def _blur_score(image: Image.Image) -> float:
    if not settings.garment_blur_check:
        return float("inf")
    try:
        import cv2  # type: ignore
    except Exception:
        return float("inf")
    gray = np.asarray(image.convert("L"))
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _validate_image(image: Image.Image, rule: GarmentRule) -> None:
    if not _has_sufficient_resolution(image, rule):
        raise GarmentValidationError("LOW_RESOLUTION")
    if _blur_score(image) < settings.garment_blur_threshold:
        raise GarmentValidationError("IMAGE_BLURRY")


def _validate_foreground_ratio(fg_ratio: float, rule: GarmentRule) -> None:
    if fg_ratio < rule.min_fg_ratio:
        raise GarmentValidationError("SUBJECT_TOO_SMALL")
    if fg_ratio > rule.max_fg_ratio:
        raise GarmentValidationError("NO_BACKGROUND_REMOVAL")


def _validate_isolated_garment(image: Image.Image, rule: GarmentRule) -> None:
    if not settings.garment_isolation_check:
        return

    bbox = _foreground_bbox(image)
    if bbox is None:
        raise GarmentValidationError("SUBJECT_TOO_SMALL")

    x0, y0, x1, y1 = bbox
    width = max(1, x1 - x0 + 1)
    height = max(1, y1 - y0 + 1)
    aspect_ratio = height / width
    if aspect_ratio > rule.max_aspect_ratio:
        raise GarmentValidationError("GARMENT_TOO_LONG")

    skin_ratio, top_skin_ratio = _skin_ratios(image)
    if (
        skin_ratio > rule.skin_ratio_threshold
        or top_skin_ratio > rule.top_skin_ratio_threshold
    ):
        raise GarmentValidationError("MODEL_WORN_GARMENT")


def _auto_crop_and_pad(image: Image.Image, padding_ratio: float) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha > settings.garment_alpha_threshold)
    if len(xs) == 0 or len(ys) == 0:
        return rgba

    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()

    pad_x = int((x1 - x0 + 1) * padding_ratio)
    pad_y = int((y1 - y0 + 1) * padding_ratio)

    x0 = max(0, x0 - pad_x)
    y0 = max(0, y0 - pad_y)
    x1 = min(rgba.width - 1, x1 + pad_x)
    y1 = min(rgba.height - 1, y1 + pad_y)

    cropped = rgba.crop((x0, y0, x1 + 1, y1 + 1))
    return cropped


def _resize_with_padding(image: Image.Image, target: Tuple[int, int]) -> Image.Image:
    target_w, target_h = target
    img = image.convert("RGBA")
    scale = min(target_w / img.width, target_h / img.height)
    new_w = max(1, int(img.width * scale))
    new_h = max(1, int(img.height * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    offset = ((target_w - new_w) // 2, (target_h - new_h) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def preprocess_garment(
    image_bytes: bytes,
    bypass_validation: bool = False,
    options: GarmentPreprocessOptions | None = None,
) -> GarmentPreprocessResult:
    image = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    opts = options or GarmentPreprocessOptions()
    rule = resolve_garment_rule(opts.garment_profile, opts.category_hint, opts.product_name, opts.garment_id)
    warnings: tuple[str, ...] = (f"BETA_CATEGORY:{rule.key.upper()}",) if rule.support_level == "beta" else ()

    if not bypass_validation:
        if rule.support_level == "unsupported":
            raise GarmentValidationError("GARMENT_CATEGORY_UNSUPPORTED")
        _validate_image(image, rule)

    if _is_clean_transparent(image):
        if not bypass_validation:
            _validate_foreground_ratio(_foreground_ratio(image), rule)
            _validate_isolated_garment(image, rule)
        resized = _resize_with_padding(image, settings.garment_target_size())
        return GarmentPreprocessResult(
            image=resized,
            did_process=False,
            reason="ALREADY_TRANSPARENT",
            profile_key=rule.key,
            profile_label=rule.label,
            support_level=rule.support_level,
            warnings=warnings,
        )

    processed = _remove_background(image)
    if not bypass_validation:
        _validate_foreground_ratio(_foreground_ratio(processed), rule)
        _validate_isolated_garment(processed, rule)
    processed = _auto_crop_and_pad(processed, rule.crop_padding_ratio)
    processed = _resize_with_padding(processed, settings.garment_target_size())

    return GarmentPreprocessResult(
        image=processed,
        did_process=True,
        reason="BACKGROUND_REMOVED",
        profile_key=rule.key,
        profile_label=rule.label,
        support_level=rule.support_level,
        warnings=warnings,
    )
