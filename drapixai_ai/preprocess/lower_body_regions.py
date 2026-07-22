from __future__ import annotations

from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFilter


LOWER_BODY_CATEGORIES = (
    "jeans",
    "pants",
    "trousers",
    "shorts",
    "skirt",
    "leggings",
    "joggers",
)


@dataclass(frozen=True)
class LowerBodyRegionProfile:
    waist: tuple[float, float, float, float]
    crotch: tuple[float, float, float, float]
    knee: tuple[float, float, float, float]
    hem: tuple[float, float, float, float]
    ankle: tuple[float, float, float, float]
    shoe: tuple[float, float, float, float]
    garment_regions: tuple[str, ...]
    preservation_regions: tuple[str, ...]


# Ratios are calibrated for DrapixAI's normalized full-body portrait frame. The
# benchmark stores pose/body-shape cohorts so these can later be replaced by
# keypoint-derived polygons without changing scorer or report contracts.
LOWER_BODY_REGION_PROFILES: dict[str, LowerBodyRegionProfile] = {
    "jeans": LowerBodyRegionProfile(
        waist=(0.23, 0.425, 0.77, 0.545),
        crotch=(0.34, 0.505, 0.66, 0.655),
        knee=(0.19, 0.630, 0.81, 0.765),
        hem=(0.24, 0.805, 0.76, 0.925),
        ankle=(0.23, 0.815, 0.77, 0.935),
        shoe=(0.16, 0.900, 0.84, 1.000),
        garment_regions=("waist", "crotch", "knee", "hem", "ankle"),
        preservation_regions=("shoe",),
    ),
    "pants": LowerBodyRegionProfile(
        waist=(0.22, 0.420, 0.78, 0.545),
        crotch=(0.33, 0.500, 0.67, 0.650),
        knee=(0.18, 0.625, 0.82, 0.770),
        hem=(0.23, 0.805, 0.77, 0.930),
        ankle=(0.22, 0.815, 0.78, 0.940),
        shoe=(0.15, 0.900, 0.85, 1.000),
        garment_regions=("waist", "crotch", "knee", "hem", "ankle"),
        preservation_regions=("shoe",),
    ),
    "trousers": LowerBodyRegionProfile(
        waist=(0.22, 0.415, 0.78, 0.535),
        crotch=(0.33, 0.495, 0.67, 0.640),
        knee=(0.17, 0.620, 0.83, 0.765),
        hem=(0.21, 0.800, 0.79, 0.935),
        ankle=(0.21, 0.815, 0.79, 0.940),
        shoe=(0.14, 0.900, 0.86, 1.000),
        garment_regions=("waist", "crotch", "knee", "hem", "ankle"),
        preservation_regions=("shoe",),
    ),
    "shorts": LowerBodyRegionProfile(
        waist=(0.23, 0.425, 0.77, 0.545),
        crotch=(0.34, 0.505, 0.66, 0.645),
        knee=(0.18, 0.625, 0.82, 0.760),
        hem=(0.23, 0.590, 0.77, 0.705),
        ankle=(0.22, 0.810, 0.78, 0.930),
        shoe=(0.15, 0.895, 0.85, 1.000),
        garment_regions=("waist", "crotch", "hem"),
        preservation_regions=("knee", "ankle", "shoe"),
    ),
    "skirt": LowerBodyRegionProfile(
        waist=(0.24, 0.415, 0.76, 0.540),
        crotch=(0.31, 0.500, 0.69, 0.650),
        knee=(0.15, 0.620, 0.85, 0.780),
        hem=(0.17, 0.650, 0.83, 0.825),
        ankle=(0.20, 0.810, 0.80, 0.930),
        shoe=(0.14, 0.895, 0.86, 1.000),
        garment_regions=("waist", "knee", "hem"),
        preservation_regions=("ankle", "shoe"),
    ),
    "leggings": LowerBodyRegionProfile(
        waist=(0.25, 0.425, 0.75, 0.545),
        crotch=(0.36, 0.505, 0.64, 0.655),
        knee=(0.22, 0.635, 0.78, 0.770),
        hem=(0.29, 0.835, 0.71, 0.930),
        ankle=(0.27, 0.815, 0.73, 0.940),
        shoe=(0.17, 0.900, 0.83, 1.000),
        garment_regions=("waist", "crotch", "knee", "hem", "ankle"),
        preservation_regions=("shoe",),
    ),
    "joggers": LowerBodyRegionProfile(
        waist=(0.21, 0.420, 0.79, 0.550),
        crotch=(0.32, 0.500, 0.68, 0.665),
        knee=(0.17, 0.620, 0.83, 0.780),
        hem=(0.25, 0.825, 0.75, 0.935),
        ankle=(0.24, 0.810, 0.76, 0.940),
        shoe=(0.15, 0.895, 0.85, 1.000),
        garment_regions=("waist", "crotch", "knee", "hem", "ankle"),
        preservation_regions=("shoe",),
    ),
}


def normalize_lower_body_category(category: str | None) -> str:
    normalized = (category or "pants").strip().lower().replace("-", "_")
    aliases = {
        "denim": "jeans",
        "denim_shorts": "shorts",
        "legging": "leggings",
        "tights": "leggings",
        "jogger": "joggers",
        "sweatpants": "joggers",
        "track_pants": "joggers",
    }
    normalized = aliases.get(normalized, normalized)
    return normalized if normalized in LOWER_BODY_REGION_PROFILES else "pants"


def lower_body_region_profile(category: str | None) -> LowerBodyRegionProfile:
    return LOWER_BODY_REGION_PROFILES[normalize_lower_body_category(category)]


def build_lower_body_region_masks(
    image: Image.Image,
    category: str | None,
    *,
    feather: int = 0,
) -> dict[str, Image.Image]:
    profile = lower_body_region_profile(category)
    width, height = image.size
    masks: dict[str, Image.Image] = {}
    for name in ("waist", "crotch", "knee", "hem", "ankle", "shoe"):
        x0, y0, x1, y1 = getattr(profile, name)
        mask = Image.new("L", image.size, 0)
        draw = ImageDraw.Draw(mask)
        box = (
            int(width * x0),
            int(height * y0),
            max(int(width * x0) + 1, int(width * x1)),
            max(int(height * y0) + 1, int(height * y1)),
        )
        radius = max(3, min(box[2] - box[0], box[3] - box[1]) // 7)
        draw.rounded_rectangle(box, radius=radius, fill=255)
        if feather > 0:
            mask = mask.filter(ImageFilter.GaussianBlur(radius=feather))
        masks[name] = mask
    return masks
