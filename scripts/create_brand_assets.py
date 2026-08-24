from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "output" / "brand"
PUBLIC_DIR = ROOT / "apps" / "web" / "public"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate DrapixAI website and high-resolution brand assets."
    )
    parser.add_argument(
        "--logo",
        type=Path,
        default=os.environ.get("DRAPIXAI_SOURCE_LOGO"),
        help="Path to the source wordmark image (or set DRAPIXAI_SOURCE_LOGO).",
    )
    parser.add_argument(
        "--emblem",
        type=Path,
        default=os.environ.get("DRAPIXAI_SOURCE_EMBLEM"),
        help="Path to the source emblem image (or set DRAPIXAI_SOURCE_EMBLEM).",
    )
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--public-dir", type=Path, default=PUBLIC_DIR)
    args = parser.parse_args()
    if args.logo is None or args.emblem is None:
        parser.error("--logo and --emblem are required unless their environment variables are set")
    for label, path in (("logo", args.logo), ("emblem", args.emblem)):
        if not path.is_file():
            parser.error(f"{label} source does not exist or is not a file: {path}")
    return args


def resize_width(image: Image.Image, width: int) -> Image.Image:
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def remove_white_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = []
    for red, green, blue, _ in rgba.getdata():
        distance = max(255 - red, 255 - green, 255 - blue)
        if distance <= 28:
            pixels.append((255, 255, 255, 0))
            continue
        alpha = min(255, round((distance - 28) * 5.1))
        alpha_fraction = alpha / 255
        foreground = tuple(
            max(0, min(255, round((channel - 255 * (1 - alpha_fraction)) / alpha_fraction)))
            for channel in (red, green, blue)
        )
        pixels.append((*foreground, alpha))
    rgba.putdata(pixels)
    return rgba


def fit_square(image: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inset = round(size * 0.08)
    available = size - inset * 2
    scale = min(available / image.width, available / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (size - resized.width) // 2
    top = (size - resized.height) // 2
    canvas.alpha_composite(resized, (left, top))
    return canvas


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.public_dir.mkdir(parents=True, exist_ok=True)

    logo = Image.open(args.logo).convert("RGB")
    logo_hd = resize_width(logo, 4096)
    logo_hd.save(args.output_dir / "DrapixAI_Logo_HD_4096.png")

    transparent_logo = remove_white_background(logo)
    transparent_logo_hd = resize_width(transparent_logo, 4096)
    transparent_logo_hd.save(args.output_dir / "DrapixAI_Logo_HD_Transparent_4096.png")
    resize_width(transparent_logo, 1400).save(
        args.public_dir / "drapixai_wordmark.webp", "WEBP", quality=95, method=6
    )

    emblem = Image.open(args.emblem).convert("RGBA")
    emblem_hd = fit_square(emblem, 2048)
    emblem_hd.save(args.output_dir / "DrapixAI_Emblem_HD_2048.png")

    fit_square(emblem, 512).save(
        args.public_dir / "drapixai_emblem.webp", "WEBP", quality=95, method=6
    )
    fit_square(emblem, 64).save(
        args.public_dir / "drapixai_emblem_64.webp", "WEBP", quality=95, method=6
    )
    fit_square(emblem, 64).save(
        args.public_dir / "drapixai_logo_64.webp", "WEBP", quality=95, method=6
    )
    resize_width(transparent_logo, 1400).save(
        args.public_dir / "drapixai_logo.webp", "WEBP", quality=95, method=6
    )

    fit_square(emblem, 180).save(args.public_dir / "apple-touch-icon.png", optimize=True)
    fit_square(emblem, 16).save(args.public_dir / "favicon-16x16.png", optimize=True)
    fit_square(emblem, 32).save(args.public_dir / "favicon-32x32.png", optimize=True)
    fit_square(emblem, 256).save(
        args.public_dir / "favicon.ico",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
