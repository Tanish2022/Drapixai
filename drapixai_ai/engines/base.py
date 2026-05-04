from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

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
