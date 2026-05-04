from __future__ import annotations

from dataclasses import dataclass, field

from PIL import Image, ImageFilter, ImageStat


@dataclass(frozen=True)
class PersonValidation:
    ok: bool
    warnings: list[str] = field(default_factory=list)


def validate_person_image(image: Image.Image, *, min_side: int = 384) -> PersonValidation:
    rgb = image.convert("RGB")
    warnings: list[str] = []
    if min(rgb.size) < min_side:
        warnings.append("PERSON_LOW_RESOLUTION")

    gray = rgb.convert("L")
    brightness = ImageStat.Stat(gray).mean[0]
    if brightness < 35:
        warnings.append("PERSON_UNDEREXPOSED")
    if brightness > 235:
        warnings.append("PERSON_OVEREXPOSED")

    edge_std = ImageStat.Stat(gray.filter(ImageFilter.FIND_EDGES)).stddev[0]
    if edge_std < 8:
        warnings.append("PERSON_BLUR_RISK")

    return PersonValidation(ok=not warnings, warnings=warnings)
