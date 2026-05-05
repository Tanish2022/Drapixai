from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageFilter, ImageOps


@dataclass(frozen=True)
class GarmentAnalysis:
    width: int
    height: int
    foreground_ratio: float
    bbox_ratio: float
    background_ratio: float
    dominant_color: tuple[int, int, int]
    warnings: list[str] = field(default_factory=list)


def isolate_garment(image: Image.Image) -> Image.Image:
    """Return an RGBA garment cutout with transparent background.

    Production inputs often arrive as product photos on white/gray backgrounds.
    CatVTON behaves better when the garment is isolated before being fitted to
    the condition canvas. Prefer rembg when present; otherwise use a conservative
    corner-color matte so deployment still works without an ONNX session.
    """

    rgba = ImageOps.exif_transpose(image).convert("RGBA")
    try:
        from rembg import remove  # type: ignore

        removed = remove(rgba)
        if isinstance(removed, Image.Image):
            alpha = np.asarray(removed.convert("RGBA"))[:, :, 3]
            fg_ratio = float((alpha > 16).mean())
            if 0.04 <= fg_ratio <= 0.88:
                return _trim_transparent_edges(removed.convert("RGBA"))
    except Exception:
        pass

    return _trim_transparent_edges(_corner_color_matte(rgba))


def prepare_garment_for_tryon(
    image: Image.Image,
    size: tuple[int, int],
    *,
    fill: tuple[int, int, int] = (255, 255, 255),
) -> Image.Image:
    cutout = isolate_garment(image)
    cutout.thumbnail((int(size[0] * 0.88), int(size[1] * 0.88)), Image.LANCZOS)
    canvas = Image.new("RGBA", size, (*fill, 255))
    x = (size[0] - cutout.width) // 2
    y = (size[1] - cutout.height) // 2
    canvas.alpha_composite(cutout, (x, y))
    return canvas.convert("RGB")


def analyze_garment(image: Image.Image) -> GarmentAnalysis:
    rgba = isolate_garment(image)
    arr = np.asarray(rgba)
    alpha = arr[:, :, 3]
    foreground = alpha > 16
    foreground_ratio = float(foreground.mean())
    bbox_ratio = _foreground_bbox_ratio(foreground)
    background_ratio = 1.0 - foreground_ratio
    pixels = arr[:, :, :3][foreground] if foreground.any() else arr[:, :, :3].reshape(-1, 3)
    dominant = tuple(int(v) for v in pixels.mean(axis=0))

    warnings: list[str] = []
    if min(image.size) < 384:
        warnings.append("GARMENT_LOW_RESOLUTION")
    if foreground_ratio < 0.08:
        warnings.append("GARMENT_SUBJECT_TOO_SMALL")
    if foreground_ratio > 0.90 or bbox_ratio > 0.94:
        warnings.append("GARMENT_BACKGROUND_DOMINANT")
    if background_ratio < 0.08:
        warnings.append("GARMENT_NOT_ISOLATED")
    if bbox_ratio < 0.16:
        warnings.append("GARMENT_CROP_TOO_LOOSE")

    return GarmentAnalysis(
        width=image.width,
        height=image.height,
        foreground_ratio=foreground_ratio,
        bbox_ratio=bbox_ratio,
        background_ratio=background_ratio,
        dominant_color=dominant,
        warnings=warnings,
    )


def _corner_color_matte(image: Image.Image) -> Image.Image:
    arr = np.asarray(image).astype(np.int16)
    rgb = arr[:, :, :3]
    alpha = arr[:, :, 3]
    h, w = alpha.shape
    sample = max(8, min(h, w) // 12)
    corners = np.concatenate(
        [
            rgb[:sample, :sample].reshape(-1, 3),
            rgb[:sample, -sample:].reshape(-1, 3),
            rgb[-sample:, :sample].reshape(-1, 3),
            rgb[-sample:, -sample:].reshape(-1, 3),
        ],
        axis=0,
    )
    bg = np.median(corners, axis=0)
    distance = np.linalg.norm(rgb - bg, axis=2)
    threshold = max(22.0, float(np.percentile(distance, 72)) * 0.72)
    fg = (distance > threshold) & (alpha > 16)
    fg = _largest_component(fg)
    soft_alpha = (fg.astype(np.uint8) * 255)
    mask = Image.fromarray(soft_alpha, mode="L").filter(ImageFilter.GaussianBlur(radius=1.2))
    result = image.copy()
    result.putalpha(mask)
    return result


def _largest_component(mask: np.ndarray) -> np.ndarray:
    try:
        import cv2  # type: ignore

        labels_count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
        if labels_count <= 1:
            return mask
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        return labels == largest
    except Exception:
        return mask


def _trim_transparent_edges(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 16 else 0).getbbox()
    if not bbox:
        return image
    pad = max(8, int(max(image.size) * 0.04))
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(image.width, bbox[2] + pad)
    bottom = min(image.height, bbox[3] + pad)
    return image.crop((left, top, right, bottom))


def _foreground_bbox_ratio(mask: np.ndarray) -> float:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return 0.0
    width = xs.max() - xs.min() + 1
    height = ys.max() - ys.min() + 1
    return float((width * height) / mask.size)
