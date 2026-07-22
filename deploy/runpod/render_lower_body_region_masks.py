from __future__ import annotations

import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from drapixai_ai.preprocess.lower_body_regions import LOWER_BODY_CATEGORIES, build_lower_body_region_masks


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", REPO_ROOT))
PERSON_PATH = Path(
    os.getenv(
        "DRAPIXAI_LOWER_BODY_REGION_PERSON",
        APP_ROOT / "runtime" / "test_assets" / "lower_body" / "person_front_standing_01.png",
    )
)
OUTPUT_PATH = Path(
    os.getenv(
        "DRAPIXAI_LOWER_BODY_REGION_PREVIEW",
        APP_ROOT / "runtime" / "lower_body_region_masks" / "contact_sheet.png",
    )
)
COLORS = {
    "waist": (230, 45, 70),
    "crotch": (255, 145, 30),
    "knee": (240, 210, 40),
    "hem": (35, 175, 95),
    "ankle": (25, 130, 215),
    "shoe": (135, 70, 205),
}


def _panel(person: Image.Image, category: str) -> Image.Image:
    base = person.convert("RGB").resize((320, 480), Image.Resampling.LANCZOS)
    overlay = Image.new("RGB", base.size, (0, 0, 0))
    alpha = Image.new("L", base.size, 0)
    masks = build_lower_body_region_masks(base, category)
    for name, color in COLORS.items():
        color_layer = Image.new("RGB", base.size, color)
        region_alpha = masks[name].point(lambda value: int(value * 0.34))
        overlay = Image.composite(color_layer, overlay, masks[name])
        alpha = Image.composite(region_alpha, alpha, masks[name])
    panel = Image.composite(overlay, base, alpha)
    draw = ImageDraw.Draw(panel)
    draw.rectangle((0, 0, 320, 28), fill=(18, 18, 18))
    draw.text((10, 7), category.upper(), fill=(255, 255, 255))
    return panel


def main() -> None:
    if not PERSON_PATH.is_file():
        raise FileNotFoundError(PERSON_PATH)
    person = Image.open(PERSON_PATH).convert("RGB")
    sheet = Image.new("RGB", (1280, 960), (28, 28, 28))
    for index, category in enumerate(LOWER_BODY_CATEGORIES):
        x = (index % 4) * 320
        y = (index // 4) * 480
        sheet.paste(_panel(person, category), (x, y))
    legend = ImageDraw.Draw(sheet)
    x0, y0 = 970, 540
    legend.text((x0, y0), "REGIONS", fill=(255, 255, 255))
    for index, (name, color) in enumerate(COLORS.items(), start=1):
        y = y0 + index * 34
        legend.rectangle((x0, y, x0 + 20, y + 20), fill=color)
        legend.text((x0 + 30, y + 3), name.upper(), fill=(235, 235, 235))
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT_PATH, format="PNG")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()
