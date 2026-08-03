from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Sequence

from PIL import Image


@dataclass(frozen=True)
class TryOnCandidate:
    image: Image.Image
    seed: int | None = None
    score: float | None = None
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class TryOnResult:
    image: Image.Image
    engine: str
    quality_score: float
    candidate_count: int
    candidate_scores: list[float] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class TryOnEngine(ABC):
    name: str

    @abstractmethod
    def load(self) -> None:
        """Load model weights and supporting processors."""

    @abstractmethod
    def generate(
        self,
        person: Image.Image,
        garment: Image.Image,
        mask: Image.Image | None = None,
        *,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        seed: int | None = None,
        garment_type: str | None = None,
    ) -> Image.Image:
        """Generate one try-on candidate."""

    def generate_batch(
        self,
        persons: Sequence[Image.Image],
        garments: Sequence[Image.Image],
        masks: Sequence[Image.Image | None] | None = None,
        *,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        seeds: Sequence[int | None] | None = None,
        garment_types: Sequence[str | None] | None = None,
    ) -> list[Image.Image]:
        """Generate candidates as a batch, falling back to isolated calls."""
        count = len(persons)
        if len(garments) != count:
            raise ValueError("BATCH_INPUT_LENGTH_MISMATCH")
        batch_masks = list(masks) if masks is not None else [None] * count
        batch_seeds = list(seeds) if seeds is not None else [None] * count
        batch_types = list(garment_types) if garment_types is not None else [None] * count
        if not (len(batch_masks) == len(batch_seeds) == len(batch_types) == count):
            raise ValueError("BATCH_INPUT_LENGTH_MISMATCH")
        return [
            self.generate(
                person,
                garment,
                mask,
                inference_steps=inference_steps,
                guidance_scale=guidance_scale,
                seed=seed,
                garment_type=garment_type,
            )
            for person, garment, mask, seed, garment_type in zip(
                persons,
                garments,
                batch_masks,
                batch_seeds,
                batch_types,
            )
        ]
