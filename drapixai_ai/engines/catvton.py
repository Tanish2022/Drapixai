from __future__ import annotations

import os
import sys
from pathlib import Path

import torch
from diffusers.image_processor import VaeImageProcessor
from PIL import Image, ImageChops, ImageDraw

from drapixai_ai.configs.settings import settings
from drapixai_ai.engines.base import TryOnEngine
from drapixai_ai.preprocess.image_normalizer import normalize_tryon_inputs
from drapixai_ai.preprocess.mask_builder import build_upper_body_mask


ROOT = Path(__file__).resolve().parents[1]
CATVTON_ROOT = ROOT / "third_party" / "CatVTON"


class CatVTONEngine(TryOnEngine):
    name = "catvton"

    def __init__(self) -> None:
        self.loaded = False
        self.device = settings.device if torch.cuda.is_available() else "cpu"
        self.width = settings.catvton_width
        self.height = settings.catvton_height

    def load(self) -> None:
        if self.loaded:
            return
        if not CATVTON_ROOT.exists():
            raise RuntimeError(
                "CatVTON code is missing. Run 'python -m drapixai_ai.scripts.prepare_catvton' first."
            )
        if str(CATVTON_ROOT) not in sys.path:
            sys.path.insert(0, str(CATVTON_ROOT))

        from huggingface_hub import snapshot_download  # noqa: PLC0415
        from model.cloth_masker import AutoMasker  # noqa: PLC0415
        from model.pipeline import CatVTONPipeline  # noqa: PLC0415
        from utils import init_weight_dtype  # noqa: PLC0415

        if self.device == "cuda":
            torch.cuda.set_device(settings.cuda_device_index)

        if settings.enable_tf32:
            torch.set_float32_matmul_precision("high")
            torch.backends.cuda.matmul.allow_tf32 = True

        repo_path = settings.catvton_model_dir
        if not Path(repo_path).exists() or not any(Path(repo_path).iterdir()):
            repo_path = snapshot_download(
                repo_id=settings.catvton_repo_id,
                local_dir=settings.catvton_model_dir,
                local_dir_use_symlinks=False,
                resume_download=True,
            )

        self.pipeline = CatVTONPipeline(
            base_ckpt=settings.catvton_base_model,
            attn_ckpt=repo_path,
            attn_ckpt_version=settings.catvton_attn_version,
            weight_dtype=init_weight_dtype(settings.catvton_mixed_precision),
            use_tf32=settings.enable_tf32,
            device=self.device,
            skip_safety_check=settings.catvton_skip_safety_check,
        )
        self.mask_processor = VaeImageProcessor(
            vae_scale_factor=8,
            do_normalize=False,
            do_binarize=True,
            do_convert_grayscale=True,
        )
        self.automasker = AutoMasker(
            densepose_ckpt=os.path.join(repo_path, "DensePose"),
            schp_ckpt=os.path.join(repo_path, "SCHP"),
            device=self.device,
        )
        self.loaded = True

    @staticmethod
    def _cloth_type(garment_type: str | None) -> str:
        normalized = (garment_type or "upper").strip().lower().replace("_", "-")
        if normalized in {"dress", "dresses", "kurta", "long-kurta", "overall"}:
            return "overall"
        if normalized in {"pants", "jeans", "trousers", "skirt", "lower"}:
            return "lower"
        return "upper"

    def _build_mask(self, person: Image.Image, garment_type: str | None) -> Image.Image:
        if settings.catvton_mask_source.strip().lower() == "placeholder":
            return build_upper_body_mask(person)
        try:
            return self.automasker(person, self._cloth_type(garment_type))["mask"]
        except Exception:
            return build_upper_body_mask(person)

    @staticmethod
    def _is_upper_garment(garment_type: str | None) -> bool:
        return CatVTONEngine._cloth_type(garment_type) == "upper"

    def _preserve_untucked_hem(self, mask: Image.Image, garment_type: str | None) -> Image.Image:
        if not settings.catvton_preserve_untucked_hem or not self._is_upper_garment(garment_type):
            return mask

        width, height = mask.size
        extension = Image.new("L", mask.size, 0)
        draw = ImageDraw.Draw(extension)
        requested_bottom = max(0.74, min(0.90, settings.catvton_hem_extension_ratio))
        max_upper_bottom = max(0.76, min(0.86, settings.catvton_upper_hem_max_ratio))
        hem_bottom = int(height * min(requested_bottom, max_upper_bottom))
        side_lift = int(height * max(0.015, min(0.08, settings.catvton_upper_hem_side_lift_ratio)))
        side_hem = max(int(height * 0.70), hem_bottom - side_lift)
        draw.polygon(
            [
                (int(width * 0.24), int(height * 0.58)),
                (int(width * 0.76), int(height * 0.58)),
                (int(width * 0.70), side_hem),
                (int(width * 0.62), hem_bottom),
                (int(width * 0.38), hem_bottom),
                (int(width * 0.30), side_hem),
            ],
            fill=220,
        )
        draw.line(
            [
                (int(width * 0.30), side_hem),
                (int(width * 0.40), hem_bottom),
                (int(width * 0.60), hem_bottom),
                (int(width * 0.70), side_hem),
            ],
            fill=255,
            width=max(4, width // 80),
        )
        return ImageChops.lighter(mask.convert("L"), extension)

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
        self.load()
        size = (self.width, self.height)
        person, garment = normalize_tryon_inputs(person, garment, size)
        mask = mask.resize(size, Image.BICUBIC) if mask else self._build_mask(person, garment_type)
        mask = self._preserve_untucked_hem(mask, garment_type)
        mask = self.mask_processor.blur(mask, blur_factor=settings.catvton_mask_blur)

        generator = None
        if seed is not None and self.device == "cuda":
            generator = torch.Generator(device=self.device).manual_seed(seed)

        with torch.inference_mode():
            result = self.pipeline(
                image=person,
                condition_image=garment,
                mask=mask,
                num_inference_steps=inference_steps or settings.inference_steps,
                guidance_scale=guidance_scale or settings.guidance_scale,
                generator=generator,
                height=self.height,
                width=self.width,
            )[0]

        return result.convert("RGB")
