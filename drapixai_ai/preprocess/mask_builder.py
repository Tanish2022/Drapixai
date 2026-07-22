from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter

from drapixai_ai.configs.settings import settings


def build_upper_body_mask(person: Image.Image) -> Image.Image:
    """Create a conservative upper-body replacement mask.

    This first version is intentionally simple and independent from legacy model internals.
    It protects face/hair/top border and focuses replacement on torso and arms.
    """

    width, height = person.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    shoulder_top = int(height * 0.245)
    chest_top = int(height * 0.31)
    waist_y = int(height * 0.68)
    hem_y = int(height * 0.78)
    left_shoulder = int(width * 0.18)
    right_shoulder = int(width * 0.82)
    left_waist = int(width * 0.29)
    right_waist = int(width * 0.71)
    left_hem = int(width * 0.24)
    right_hem = int(width * 0.76)

    torso = [
        (left_shoulder, chest_top),
        (right_shoulder, chest_top),
        (right_waist, waist_y),
        (right_hem, hem_y),
        (left_hem, hem_y),
        (left_waist, waist_y),
    ]
    draw.polygon(torso, fill=255)

    arm_width = max(12, int(width * 0.115))
    draw.rounded_rectangle(
        (left_shoulder - arm_width, shoulder_top, left_shoulder + arm_width // 2, int(height * 0.70)),
        radius=max(10, width // 28),
        fill=210,
    )
    draw.rounded_rectangle(
        (right_shoulder - arm_width // 2, shoulder_top, right_shoulder + arm_width, int(height * 0.70)),
        radius=max(10, width // 28),
        fill=210,
    )

    neck_protect = (int(width * 0.36), int(height * 0.20), int(width * 0.64), int(height * 0.35))
    draw.ellipse(neck_protect, fill=0)
    face_protect = (int(width * 0.28), 0, int(width * 0.72), int(height * 0.27))
    draw.ellipse(face_protect, fill=0)

    return mask.filter(ImageFilter.GaussianBlur(radius=max(4, width // 120)))


def build_lower_body_mask(person: Image.Image, *, preserve_shoes: bool | None = None) -> Image.Image:
    """Create a conservative lower-body replacement mask.

    This is a fallback for future lower-body beta work when CatVTON AutoMasker is
    unavailable. The production path should prefer AutoMasker cloth_type="lower".
    """

    width, height = person.size
    preserve_feet = settings.lower_body_preserve_shoes if preserve_shoes is None else preserve_shoes
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)

    waist_y = int(height * max(0.40, min(0.56, settings.lower_body_mask_waist_ratio)))
    ankle_y = int(height * max(0.82, min(0.96, settings.lower_body_mask_ankle_ratio)))
    shoe_protect_y = int(height * 0.92) if preserve_feet else min(height, ankle_y + int(height * 0.05))

    hip_left = int(width * 0.28)
    hip_right = int(width * 0.72)
    thigh_left = int(width * 0.24)
    thigh_right = int(width * 0.76)
    knee_y = int(height * 0.68)
    ankle_left = int(width * 0.34)
    ankle_right = int(width * 0.66)

    draw.polygon(
        [
            (hip_left, waist_y),
            (hip_right, waist_y),
            (thigh_right, knee_y),
            (ankle_right, shoe_protect_y),
            (ankle_left, shoe_protect_y),
            (thigh_left, knee_y),
        ],
        fill=245,
    )

    # Separate leg coverage helps fallback masks follow pants without becoming a full rectangle.
    center_gap = max(8, width // 30)
    leg_width = max(18, width // 9)
    draw.rounded_rectangle(
        (
            int(width * 0.40) - leg_width,
            int(height * 0.58),
            int(width * 0.50) - center_gap // 2,
            shoe_protect_y,
        ),
        radius=max(10, width // 35),
        fill=255,
    )
    draw.rounded_rectangle(
        (
            int(width * 0.50) + center_gap // 2,
            int(height * 0.58),
            int(width * 0.60) + leg_width,
            shoe_protect_y,
        ),
        radius=max(10, width // 35),
        fill=255,
    )

    if preserve_feet:
        draw.rectangle((0, int(height * 0.92), width, height), fill=0)

    return mask.filter(ImageFilter.GaussianBlur(radius=max(4, settings.lower_body_mask_blur)))


def build_pants_mask(person: Image.Image, *, preserve_shoes: bool | None = None) -> Image.Image:
    return build_lower_body_mask(person, preserve_shoes=preserve_shoes)


def build_lower_body_mask_for_category(
    person: Image.Image,
    category: str | None = None,
    *,
    preserve_shoes: bool | None = None,
) -> Image.Image:
    normalized = (category or "").strip().lower().replace("-", "_")
    if normalized in {"short", "shorts", "denim_shorts"}:
        return build_shorts_mask(person)
    if normalized in {"skirt", "mini_skirt", "pencil_skirt", "a_line_skirt"}:
        return build_skirt_mask(person)
    if normalized in {"leggings", "legging", "tights", "yoga_pants"}:
        return build_leggings_mask(person, preserve_shoes=preserve_shoes)
    if normalized in {"joggers", "jogger", "sweatpants", "track_pants"}:
        return build_joggers_mask(person, preserve_shoes=preserve_shoes)
    return build_pants_mask(person, preserve_shoes=preserve_shoes)


def build_shorts_mask(person: Image.Image) -> Image.Image:
    width, height = person.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    waist_y = int(height * max(0.40, min(0.56, settings.lower_body_mask_waist_ratio)))
    hem_y = int(height * 0.66)
    draw.polygon(
        [
            (int(width * 0.28), waist_y),
            (int(width * 0.72), waist_y),
            (int(width * 0.68), hem_y),
            (int(width * 0.55), int(height * 0.69)),
            (int(width * 0.50), int(height * 0.62)),
            (int(width * 0.45), int(height * 0.69)),
            (int(width * 0.32), hem_y),
        ],
        fill=255,
    )
    return mask.filter(ImageFilter.GaussianBlur(radius=max(4, settings.lower_body_mask_blur)))


def build_skirt_mask(person: Image.Image) -> Image.Image:
    width, height = person.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    waist_y = int(height * max(0.40, min(0.56, settings.lower_body_mask_waist_ratio)))
    hem_y = int(height * 0.78)
    draw.polygon(
        [
            (int(width * 0.31), waist_y),
            (int(width * 0.69), waist_y),
            (int(width * 0.78), hem_y),
            (int(width * 0.22), hem_y),
        ],
        fill=255,
    )
    return mask.filter(ImageFilter.GaussianBlur(radius=max(4, settings.lower_body_mask_blur)))


def build_leggings_mask(person: Image.Image, *, preserve_shoes: bool | None = None) -> Image.Image:
    width, height = person.size
    preserve_feet = settings.lower_body_preserve_shoes if preserve_shoes is None else preserve_shoes
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    waist_y = int(height * max(0.40, min(0.56, settings.lower_body_mask_waist_ratio)))
    shoe_protect_y = int(height * 0.92) if preserve_feet else int(height * 0.95)
    center_gap = max(8, width // 34)
    thigh_width = max(18, width // 10)
    ankle_width = max(14, width // 16)
    knee_y = int(height * 0.70)

    draw.polygon(
        [
            (int(width * 0.31), waist_y),
            (int(width * 0.69), waist_y),
            (int(width * 0.63), knee_y),
            (int(width * 0.59), shoe_protect_y),
            (int(width * 0.50) + center_gap // 2, shoe_protect_y),
            (int(width * 0.50) + center_gap // 2, int(height * 0.59)),
            (int(width * 0.50) - center_gap // 2, int(height * 0.59)),
            (int(width * 0.50) - center_gap // 2, shoe_protect_y),
            (int(width * 0.41), shoe_protect_y),
            (int(width * 0.37), knee_y),
        ],
        fill=230,
    )
    draw.rounded_rectangle(
        (int(width * 0.42) - thigh_width, int(height * 0.58), int(width * 0.50) - center_gap // 2, shoe_protect_y),
        radius=max(8, ankle_width),
        fill=255,
    )
    draw.rounded_rectangle(
        (int(width * 0.50) + center_gap // 2, int(height * 0.58), int(width * 0.58) + thigh_width, shoe_protect_y),
        radius=max(8, ankle_width),
        fill=255,
    )
    if preserve_feet:
        draw.rectangle((0, int(height * 0.92), width, height), fill=0)
    return mask.filter(ImageFilter.GaussianBlur(radius=max(4, settings.lower_body_mask_blur)))


def build_joggers_mask(person: Image.Image, *, preserve_shoes: bool | None = None) -> Image.Image:
    width, height = person.size
    preserve_feet = settings.lower_body_preserve_shoes if preserve_shoes is None else preserve_shoes
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    waist_y = int(height * max(0.40, min(0.56, settings.lower_body_mask_waist_ratio)))
    cuff_y = int(height * 0.90) if preserve_feet else int(height * 0.94)
    knee_y = int(height * 0.70)
    center_gap = max(10, width // 28)

    draw.polygon(
        [
            (int(width * 0.27), waist_y),
            (int(width * 0.73), waist_y),
            (int(width * 0.70), knee_y),
            (int(width * 0.63), cuff_y),
            (int(width * 0.52), cuff_y),
            (int(width * 0.50) + center_gap // 2, int(height * 0.60)),
            (int(width * 0.50) - center_gap // 2, int(height * 0.60)),
            (int(width * 0.48), cuff_y),
            (int(width * 0.37), cuff_y),
            (int(width * 0.30), knee_y),
        ],
        fill=255,
    )
    draw.rectangle((int(width * 0.35), int(height * 0.86), int(width * 0.49), cuff_y), fill=245)
    draw.rectangle((int(width * 0.51), int(height * 0.86), int(width * 0.65), cuff_y), fill=245)
    if preserve_feet:
        draw.rectangle((0, int(height * 0.92), width, height), fill=0)
    return mask.filter(ImageFilter.GaussianBlur(radius=max(4, settings.lower_body_mask_blur)))
