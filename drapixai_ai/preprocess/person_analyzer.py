from __future__ import annotations

from dataclasses import dataclass, field

from PIL import Image

from drapixai_ai.preprocess.person_validator import validate_person_image


@dataclass(frozen=True)
class PersonAnalysis:
    width: int
    height: int
    validation_warnings: list[str] = field(default_factory=list)


def analyze_person(image: Image.Image) -> PersonAnalysis:
    validation = validate_person_image(image)
    return PersonAnalysis(
        width=image.width,
        height=image.height,
        validation_warnings=validation.warnings,
    )
