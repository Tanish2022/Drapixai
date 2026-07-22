from __future__ import annotations

from PIL import Image, ImageDraw

from drapixai_ai.services.garment_preprocessor import (
    GarmentValidationError,
    _validate_isolated_garment,
)
from drapixai_ai.services.garment_rules import resolve_garment_rule


SIZE = (1024, 1365)


def isolated_garment(*, color: tuple[int, int, int, int]) -> Image.Image:
    image = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.polygon(
        [(250, 220), (120, 390), (250, 510), (305, 430), (305, 1175), (719, 1175), (719, 430), (774, 510), (904, 390), (774, 220)],
        fill=color,
    )
    return image


def assert_not_model_worn(image: Image.Image) -> None:
    _validate_isolated_garment(image, resolve_garment_rule("tshirt"))


def main() -> None:
    graphic = isolated_garment(color=(18, 18, 18, 255))
    ImageDraw.Draw(graphic).ellipse((350, 480, 674, 860), fill=(205, 116, 100, 255))
    assert_not_model_worn(graphic)

    beige = isolated_garment(color=(198, 150, 112, 255))
    assert_not_model_worn(beige)

    model_worn = isolated_garment(color=(18, 18, 18, 255))
    draw = ImageDraw.Draw(model_worn)
    draw.ellipse((402, 40, 622, 280), fill=(196, 132, 102, 255))
    draw.rounded_rectangle((130, 430, 255, 1110), radius=55, fill=(196, 132, 102, 255))
    draw.rounded_rectangle((769, 430, 894, 1110), radius=55, fill=(196, 132, 102, 255))
    try:
        _validate_isolated_garment(model_worn, resolve_garment_rule("tshirt"))
    except GarmentValidationError as exc:
        assert exc.reason == "MODEL_WORN_GARMENT"
    else:
        raise AssertionError("Model-worn garment must be rejected")

    print("Garment skin-detection validation passed.")


if __name__ == "__main__":
    main()
