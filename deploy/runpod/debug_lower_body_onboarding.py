from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from drapixai_ai.configs.settings import settings
from drapixai_ai.services.garment_preprocessor import (
    GarmentPreprocessOptions,
    GarmentValidationError,
    preprocess_garment,
)


def _garment_bytes(category: str) -> bytes:
    image = Image.new("RGBA", (900, 1300), (0, 0, 0, 0))
    pixels = image.load()

    def fill_box(x0: int, y0: int, x1: int, y1: int, color: tuple[int, int, int, int]) -> None:
        for y in range(y0, y1):
            for x in range(x0, x1):
                pixels[x, y] = color

    if category in {"jeans", "pants", "trousers"}:
        color = (35, 75, 150, 255) if category == "jeans" else (40, 42, 48, 255)
        fill_box(255, 120, 645, 1120, color)
        fill_box(390, 520, 510, 1120, (0, 0, 0, 0))
        fill_box(255, 120, 645, 150, (22, 45, 100, 255))
    elif category == "shorts":
        fill_box(250, 240, 650, 790, (50, 90, 170, 255))
        fill_box(410, 560, 490, 790, (0, 0, 0, 0))
        fill_box(250, 240, 650, 270, (30, 60, 130, 255))
    elif category == "skirt":
        for y in range(180, 920):
            row_width = int(300 + (y - 180) * 0.35)
            x0 = max(130, 450 - row_width // 2)
            x1 = min(770, 450 + row_width // 2)
            fill_box(x0, y, x1, y + 1, (150, 40, 95, 255))
        fill_box(300, 180, 600, 215, (110, 30, 70, 255))
    elif category == "leggings":
        fill_box(285, 120, 615, 1140, (30, 30, 34, 255))
        fill_box(405, 500, 495, 1140, (0, 0, 0, 0))
    elif category == "joggers":
        fill_box(250, 120, 650, 1120, (85, 90, 98, 255))
        fill_box(385, 520, 515, 1120, (0, 0, 0, 0))
        fill_box(270, 1040, 385, 1120, (55, 58, 65, 255))
        fill_box(515, 1040, 630, 1120, (55, 58, 65, 255))
    else:
        raise ValueError(category)

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def main() -> None:
    categories = ["jeans", "pants", "trousers", "shorts", "skirt", "leggings", "joggers"]
    report: dict[str, object] = {
        "enable_lower_body": settings.enable_lower_body,
        "categories": {},
    }
    for category in categories:
        try:
            result = preprocess_garment(
                _garment_bytes(category),
                options=GarmentPreprocessOptions(category_hint=category, garment_type="lower"),
            )
            report["categories"][category] = {
                "ok": True,
                "profile_key": result.profile_key,
                "support_level": result.support_level,
                "size": result.image.size,
                "warnings": result.warnings,
            }
        except GarmentValidationError as exc:
            report["categories"][category] = {
                "ok": False,
                "reason": exc.reason,
            }

    output_dir = ROOT_DIR / "runtime" / "lower_body_v1_scaffold"
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "onboarding_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
