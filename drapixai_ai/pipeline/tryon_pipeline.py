from __future__ import annotations

import io
import os
import sys
from contextlib import nullcontext
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from drapixai_ai.configs.settings import settings


ROOT = Path(__file__).resolve().parents[1]
THIRD_PARTY = ROOT / "third_party" / "IDM-VTON"
if str(THIRD_PARTY) not in sys.path:
    sys.path.insert(0, str(THIRD_PARTY))
if str(THIRD_PARTY / "gradio_demo") not in sys.path:
    sys.path.insert(0, str(THIRD_PARTY / "gradio_demo"))
OPENPOSE_ROOT = THIRD_PARTY / "preprocess" / "openpose"
if str(OPENPOSE_ROOT) not in sys.path:
    sys.path.insert(0, str(OPENPOSE_ROOT))

from diffusers import AutoencoderKL, DDPMScheduler  # noqa: E402
from transformers import (  # noqa: E402
    AutoTokenizer,
    CLIPImageProcessor,
    CLIPTextModel,
    CLIPTextModelWithProjection,
    CLIPVisionModelWithProjection,
)

from src.tryon_pipeline import StableDiffusionXLInpaintPipeline as TryonPipeline  # noqa: E402
from src.unet_hacked_tryon import UNet2DConditionModel  # noqa: E402
from src.unet_hacked_garmnet import UNet2DConditionModel as UNet2DConditionModelRef  # noqa: E402
from preprocess.humanparsing.run_parsing import Parsing  # noqa: E402
from preprocess.openpose.annotator.openpose import OpenposeDetector  # noqa: E402
from preprocess.openpose.annotator.util import HWC3, resize_image  # noqa: E402
from gradio_demo.utils_mask import get_mask_location  # noqa: E402


class DrapixAITryOnPipeline:
    def __init__(self) -> None:
        if settings.enable_tf32:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True

        self.device = settings.device if torch.cuda.is_available() else "cpu"
        if self.device == "cuda":
            torch.cuda.set_device(settings.cuda_device_index)

        self.height = settings.input_max_side
        self.width = int(self.height * 3 / 4)

        base_path = settings.model_dir

        self.unet = UNet2DConditionModel.from_pretrained(
            base_path,
            subfolder="unet",
            torch_dtype=torch.float16,
        )
        self.unet.requires_grad_(False)

        self.unet_encoder = UNet2DConditionModelRef.from_pretrained(
            base_path,
            subfolder="unet_encoder",
            torch_dtype=torch.float16,
        )
        self.unet_encoder.requires_grad_(False)

        self.text_encoder_one = CLIPTextModel.from_pretrained(
            base_path,
            subfolder="text_encoder",
            torch_dtype=torch.float16,
        )
        self.text_encoder_two = CLIPTextModelWithProjection.from_pretrained(
            base_path,
            subfolder="text_encoder_2",
            torch_dtype=torch.float16,
        )
        self.image_encoder = CLIPVisionModelWithProjection.from_pretrained(
            base_path,
            subfolder="image_encoder",
            torch_dtype=torch.float16,
        )
        self.vae = AutoencoderKL.from_pretrained(
            base_path,
            subfolder="vae",
            torch_dtype=torch.float16,
        )
        self.noise_scheduler = DDPMScheduler.from_pretrained(base_path, subfolder="scheduler")

        self.tokenizer_one = AutoTokenizer.from_pretrained(
            base_path,
            subfolder="tokenizer",
            revision=None,
            use_fast=False,
        )
        self.tokenizer_two = AutoTokenizer.from_pretrained(
            base_path,
            subfolder="tokenizer_2",
            revision=None,
            use_fast=False,
        )

        self.pipe = TryonPipeline.from_pretrained(
            base_path,
            unet=self.unet,
            vae=self.vae,
            feature_extractor=CLIPImageProcessor(),
            text_encoder=self.text_encoder_one,
            text_encoder_2=self.text_encoder_two,
            tokenizer=self.tokenizer_one,
            tokenizer_2=self.tokenizer_two,
            scheduler=self.noise_scheduler,
            image_encoder=self.image_encoder,
            torch_dtype=torch.float16,
        )
        self.pipe.unet_encoder = self.unet_encoder
        if settings.enable_cpu_offload and self.device == "cuda":
            self.pipe.enable_model_cpu_offload()
        else:
            self.pipe.to(self.device)

        if settings.enable_xformers:
            try:
                self.pipe.enable_xformers_memory_efficient_attention()
            except Exception:
                pass

        self.pipe.enable_attention_slicing()
        self.pipe.enable_vae_slicing()
        if settings.enable_vae_tiling:
            self.pipe.enable_vae_tiling()


        self.parsing_model = Parsing(0)
        self.openpose_detector = OpenposeDetector()

        self.tensor_transform = transforms.Compose(
            [
                transforms.ToTensor(),
                transforms.Normalize([0.5], [0.5]),
            ]
        )

    @staticmethod
    def _to_pil(image_bytes: bytes) -> Image.Image:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        return img

    def _resize_inputs(self, person: Image.Image, cloth: Image.Image) -> Tuple[Image.Image, Image.Image]:
        person_resized = person.resize((self.width, self.height), Image.BICUBIC)
        cloth_resized = cloth.resize((self.width, self.height), Image.BICUBIC)
        return person_resized, cloth_resized

    def _openpose(self, image: Image.Image) -> Tuple[dict, Image.Image]:
        np_img = np.asarray(image)
        np_img = HWC3(np_img)
        resized = resize_image(np_img, 384)
        h, w, _ = resized.shape
        pose, detected_map = self.openpose_detector(resized, hand_and_face=False)

        keypoints = self._pose_to_keypoints(pose, w, h)
        pose_img = Image.fromarray(detected_map[:, :, ::-1]).resize((self.width, self.height))
        return keypoints, pose_img

    @staticmethod
    def _pose_to_keypoints(pose: dict, width: int, height: int) -> dict:
        bodies = pose.get("bodies", {})
        candidate = bodies.get("candidate", [])
        subset = bodies.get("subset", [])
        if not subset:
            return {"pose_keypoints_2d": [[0, 0]] * 18}

        subset = list(subset[0])[:18]
        candidate = [list(c[:2]) for c in candidate]

        for i in range(18):
            if subset[i] == -1:
                candidate.insert(i, [0, 0])
                for j in range(i, 18):
                    if subset[j] != -1:
                        subset[j] += 1
            elif subset[i] != i:
                candidate.pop(i)
                for j in range(i, 18):
                    if subset[j] != -1:
                        subset[j] -= 1

        candidate = candidate[:18]
        for i in range(18):
            candidate[i][0] *= width
            candidate[i][1] *= height

        return {"pose_keypoints_2d": candidate}

    def _auto_mask(self, person: Image.Image, keypoints: dict) -> Image.Image:
        parse_img, _ = self.parsing_model(person.resize((384, 512)))
        mask, _ = get_mask_location("hd", "upper_body", parse_img, keypoints)
        return mask.resize((self.width, self.height), Image.BICUBIC)

    def run_tryon(
        self,
        person: Image.Image,
        cloth: Image.Image,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
    ) -> Image.Image:
        person, cloth = self._resize_inputs(person, cloth)
        steps = inference_steps or settings.inference_steps
        guidance = guidance_scale or settings.guidance_scale

        keypoints, pose_img = self._openpose(person)
        mask = self._auto_mask(person, keypoints)

        prompt = (
            "photorealistic, high detail, true-to-life fabric texture, "
            "natural body proportions, consistent lighting, model wearing the garment"
        )
        negative_prompt = (
            "cartoon, illustration, lowres, blurry, bad anatomy, deformed body, "
            "wrong proportions, distorted garment, color shift, washed out"
        )
        cloth_prompt = (
            "a high-resolution photo of the garment, preserve original colors and patterns"
        )
        prompt_device = self.device

        autocast_ctx = (
            torch.autocast(device_type="cuda", dtype=torch.float16)
            if self.device == "cuda"
            else nullcontext()
        )
        with torch.inference_mode(), autocast_ctx:
            (
                prompt_embeds,
                negative_prompt_embeds,
                pooled_prompt_embeds,
                negative_pooled_prompt_embeds,
            ) = self.pipe.encode_prompt(
                prompt,
                device=prompt_device,
                num_images_per_prompt=1,
                do_classifier_free_guidance=True,
                negative_prompt=negative_prompt,
            )

            (prompt_embeds_c, _, _, _) = self.pipe.encode_prompt(
                cloth_prompt,
                device=prompt_device,
                num_images_per_prompt=1,
                do_classifier_free_guidance=False,
                negative_prompt=negative_prompt,
            )

            if settings.low_vram_mode and self.device == "cuda":
                self.text_encoder_one.to("cpu")
                self.text_encoder_two.to("cpu")
                torch.cuda.empty_cache()

            pose_tensor = self.tensor_transform(pose_img).unsqueeze(0).to(self.device, torch.float16)
            cloth_tensor = self.tensor_transform(cloth).unsqueeze(0).to(self.device, torch.float16)

            images = self.pipe(
                prompt_embeds=prompt_embeds.to(self.device, torch.float16),
                negative_prompt_embeds=negative_prompt_embeds.to(self.device, torch.float16),
                pooled_prompt_embeds=pooled_prompt_embeds.to(self.device, torch.float16),
                negative_pooled_prompt_embeds=negative_pooled_prompt_embeds.to(self.device, torch.float16),
                num_inference_steps=steps,
                strength=1.0,
                pose_img=pose_tensor,
                text_embeds_cloth=prompt_embeds_c.to(self.device, torch.float16),
                cloth=cloth_tensor,
                mask_image=mask,
                image=person,
                height=self.height,
                width=self.width,
                ip_adapter_image=cloth.resize((self.width, self.height)),
                guidance_scale=guidance,
            )[0]

        return images[0]

    def run_tryon_batch(self, persons: Iterable[Image.Image], cloths: Iterable[Image.Image]) -> List[Image.Image]:
        outputs: List[Image.Image] = []
        for person, cloth in zip(persons, cloths):
            outputs.append(self.run_tryon(person, cloth))
        return outputs
