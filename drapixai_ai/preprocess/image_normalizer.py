from __future__ import annotations

from PIL import Image, ImageOps


def fit_to_canvas(image: Image.Image, size: tuple[int, int], *, fill: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail(size, Image.LANCZOS)
    canvas = Image.new("RGB", size, fill)
    x = (size[0] - image.width) // 2
    y = (size[1] - image.height) // 2
    canvas.paste(image, (x, y))
    return canvas


def resize_and_crop(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = ImageOps.exif_transpose(image).convert("RGB")
    return ImageOps.fit(image, size, method=Image.BICUBIC, centering=(0.5, 0.45))


def normalize_tryon_inputs(
    person: Image.Image,
    garment: Image.Image,
    size: tuple[int, int],
) -> tuple[Image.Image, Image.Image]:
    return resize_and_crop(person, size), fit_to_canvas(garment, size)
