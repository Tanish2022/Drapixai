from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT_DIR = Path(__file__).resolve().parents[2]
ASSET_ROOT = ROOT_DIR / "runtime" / "test_assets" / "lower_body"
GARMENT_ROOT = ASSET_ROOT / "garments"
MATRIX_FILE = ROOT_DIR / "runtime" / "test_assets" / "lower_body_matrix.json"


def _save_person(path: Path, *, stance: str = "straight", shirt: tuple[int, int, int] = (238, 238, 238)) -> None:
    image = Image.new("RGB", (768, 1152), (238, 238, 236))
    draw = ImageDraw.Draw(image)

    draw.ellipse((318, 82, 450, 214), fill=(182, 132, 104))
    shirt_color = (220, 224, 230) if shirt == (238, 238, 238) else shirt
    draw.rectangle((285, 210, 483, 510), fill=shirt_color)
    draw.rectangle((252, 292, 284, 625), fill=(182, 132, 104))
    draw.rectangle((484, 292, 516, 625), fill=(182, 132, 104))
    draw.rectangle((250, 495, 518, 555), fill=(28, 54, 114))

    if stance == "relaxed":
        left_leg = [(260, 535), (360, 535), (345, 970), (226, 970)]
        right_leg = [(408, 535), (508, 535), (540, 970), (420, 970)]
    else:
        left_leg = [(258, 535), (368, 535), (368, 970), (238, 970)]
        right_leg = [(400, 535), (510, 535), (530, 970), (400, 970)]

    draw.polygon(left_leg, fill=(38, 72, 145))
    draw.polygon(right_leg, fill=(38, 72, 145))
    for y in range(552, 958, 18):
        draw.line((270, y, 356, y), fill=(60, 94, 166), width=2)
        draw.line((412, y, 500, y), fill=(60, 94, 166), width=2)
    draw.line((260, 540, 240, 962), fill=(20, 45, 108), width=3)
    draw.line((508, 540, 528, 962), fill=(20, 45, 108), width=3)
    draw.line((384, 555, 384, 958), fill=(16, 30, 80), width=5)
    draw.line((252, 515, 516, 515), fill=(72, 98, 154), width=3)
    draw.line((252, 545, 516, 545), fill=(12, 32, 84), width=3)
    draw.rectangle((224, 968, 386, 1042), fill=(28, 28, 28))
    draw.rectangle((394, 968, 552, 1042), fill=(28, 28, 28))
    draw.line((224, 1028, 386, 1028), fill=(210, 210, 206), width=4)
    draw.line((394, 1028, 552, 1028), fill=(210, 210, 206), width=4)
    image.save(path, format="PNG")


def _save_garment(path: Path, category: str) -> None:
    image = Image.new("RGBA", (900, 1300), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if category in {"jeans", "pants", "trousers"}:
        color = (35, 74, 150, 255) if category == "jeans" else (44, 44, 50, 255)
        if category == "trousers":
            color = (36, 38, 42, 255)
        draw.rectangle((255, 120, 645, 160), fill=(22, 45, 100, 255))
        draw.polygon([(255, 160), (430, 160), (395, 1140), (230, 1140)], fill=color)
        draw.polygon([(470, 160), (645, 160), (670, 1140), (505, 1140)], fill=color)
        draw.line((450, 170, 450, 1135), fill=(12, 24, 62, 255), width=6)
    elif category == "shorts":
        draw.rectangle((250, 240, 650, 278), fill=(30, 60, 130, 255))
        draw.polygon([(250, 278), (430, 278), (392, 790), (235, 790)], fill=(52, 92, 172, 255))
        draw.polygon([(470, 278), (650, 278), (665, 790), (508, 790)], fill=(52, 92, 172, 255))
    elif category == "skirt":
        draw.rectangle((300, 180, 600, 218), fill=(110, 30, 70, 255))
        draw.polygon([(310, 218), (590, 218), (740, 925), (160, 925)], fill=(150, 42, 96, 255))
        draw.line((450, 226, 450, 918), fill=(120, 32, 78, 255), width=4)
    elif category == "leggings":
        draw.rectangle((285, 120, 615, 152), fill=(24, 24, 28, 255))
        draw.polygon([(285, 152), (430, 152), (394, 1160), (266, 1160)], fill=(30, 30, 34, 255))
        draw.polygon([(470, 152), (615, 152), (634, 1160), (506, 1160)], fill=(30, 30, 34, 255))
    elif category == "joggers":
        draw.rectangle((250, 120, 650, 160), fill=(64, 68, 76, 255))
        draw.polygon([(250, 160), (430, 160), (392, 1045), (250, 1045)], fill=(86, 91, 99, 255))
        draw.polygon([(470, 160), (650, 160), (650, 1045), (508, 1045)], fill=(86, 91, 99, 255))
        draw.rectangle((248, 1045, 394, 1135), fill=(56, 60, 68, 255))
        draw.rectangle((506, 1045, 652, 1135), fill=(56, 60, 68, 255))
    else:
        raise ValueError(category)

    pixels = np.asarray(image).copy()
    opaque = pixels[:, :, 3] > 0
    y_coords, x_coords = np.indices(opaque.shape)
    weave = ((x_coords * 13 + y_coords * 7) % 17 - 8).astype(np.int16)
    rgb = pixels[:, :, :3].astype(np.int16)
    textured = np.clip(rgb + weave[:, :, None], 0, 255).astype(np.uint8)
    pixels[:, :, :3] = np.where(opaque[:, :, None], textured, pixels[:, :, :3])
    Image.fromarray(pixels, mode="RGBA").save(path, format="PNG")


def main() -> None:
    GARMENT_ROOT.mkdir(parents=True, exist_ok=True)
    categories = ["jeans", "pants", "trousers", "shorts", "skirt", "leggings", "joggers"]
    cases: list[dict[str, str]] = []

    for index, category in enumerate(categories, start=1):
        person_name = f"person_front_standing_{index:02d}.png"
        garment_name = f"{category}_front.png"
        _save_person(ASSET_ROOT / person_name, stance="relaxed" if category in {"pants", "joggers"} else "straight")
        _save_garment(GARMENT_ROOT / garment_name, category)
        cases.append(
            {
                "slug": f"{category}-synthetic-a100-{index:02d}",
                "person_path": f"runtime/test_assets/lower_body/{person_name}",
                "garment_path": f"runtime/test_assets/lower_body/garments/{garment_name}",
                "category": category,
                "notes": "Synthetic launch workflow asset for A100 timing and category path testing.",
            }
        )

    MATRIX_FILE.parent.mkdir(parents=True, exist_ok=True)
    MATRIX_FILE.write_text(json.dumps({"cases": cases}, indent=2), encoding="utf-8")
    print(MATRIX_FILE)


if __name__ == "__main__":
    main()
