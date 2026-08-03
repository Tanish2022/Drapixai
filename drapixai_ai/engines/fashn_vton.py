from __future__ import annotations

from typing import Any

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.engines.base import TryOnEngine


class FashnVTONEngine(TryOnEngine):
    """Lazy adapter for the dedicated lower-body FASHN worker."""

    name = "fashn_vton_1_5"

    def __init__(self) -> None:
        self.pipeline: Any | None = None
        self.loaded = False
        self.last_generation_mask: Image.Image | None = None
        self.last_generation_masks: list[Image.Image | None] = []
        self.last_safety_blocked = False
        self.last_safety_blocked_flags: list[bool] = []

    def load(self) -> None:
        if self.loaded:
            return
        try:
            from fashn_vton import TryOnPipeline
        except ImportError as exc:
            raise RuntimeError(
                "FASHN_VTON_NOT_INSTALLED: use the dedicated lower-body worker environment"
            ) from exc

        self.pipeline = TryOnPipeline(
            weights_dir=settings.fashn_weights_dir,
            device=settings.device,
        )
        self.loaded = True

    @staticmethod
    def _is_lower_body(garment_type: str | None) -> bool:
        normalized = (garment_type or "").strip().lower().replace("-", "_")
        return normalized in {
            "lower",
            "lower_body",
            "jeans",
            "pants",
            "trousers",
            "shorts",
            "skirt",
            "leggings",
            "joggers",
        } or normalized.startswith("lower:") or normalized.startswith("lower_body:")

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
        if not self._is_lower_body(garment_type):
            raise ValueError("FASHN_VTON_LOWER_BODY_ONLY")
        self.load()
        if self.pipeline is None:
            raise RuntimeError("FASHN_VTON_PIPELINE_NOT_LOADED")

        result = self.pipeline(
            person_image=person.convert("RGB"),
            garment_image=garment.convert("RGB"),
            category="bottoms",
            garment_photo_type=settings.fashn_garment_photo_type,
            num_samples=1,
            num_timesteps=inference_steps or settings.fashn_num_timesteps,
            guidance_scale=(
                guidance_scale
                if guidance_scale is not None
                else settings.fashn_guidance_scale
            ),
            seed=42 if seed is None else seed,
            segmentation_free=settings.fashn_segmentation_free,
        )
        if not result.images:
            raise RuntimeError("FASHN_VTON_EMPTY_OUTPUT")

        self.last_generation_mask = mask
        self.last_safety_blocked = False
        return result.images[0].convert("RGB")
