from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter


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
