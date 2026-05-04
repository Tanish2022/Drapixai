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

    left = int(width * 0.16)
    right = int(width * 0.84)
    top = int(height * 0.28)
    bottom = int(height * 0.82)
    draw.rounded_rectangle((left, top, right, bottom), radius=max(12, width // 24), fill=255)

    neck_protect = (int(width * 0.36), int(height * 0.20), int(width * 0.64), int(height * 0.35))
    draw.ellipse(neck_protect, fill=0)

    return mask.filter(ImageFilter.GaussianBlur(radius=max(3, width // 128)))
