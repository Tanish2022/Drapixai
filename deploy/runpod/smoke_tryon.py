from __future__ import annotations

import base64
import io
import json
from pathlib import Path

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline


def main() -> None:
    base = Path("/workspace/drapixai/runtime/test_assets")
    person = Image.open(base / "person.jpg").convert("RGB")

    preprocess_payload = json.loads((base / "preprocess.json").read_text())
    cloth_raw = Image.open(io.BytesIO(base64.b64decode(preprocess_payload["image_base64"])))
    if cloth_raw.mode in ("RGBA", "LA"):
        rgba = cloth_raw.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        cloth = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        cloth = cloth_raw.convert("RGB")

    pipeline = DrapixAITryOnPipeline()
    result = pipeline.run_tryon(
        person,
        cloth,
        inference_steps=settings.enhanced_inference_steps,
        guidance_scale=settings.enhanced_guidance_scale,
    )

    output_path = base / "result_direct.png"
    result.save(output_path, format="PNG")
    print(output_path)


if __name__ == "__main__":
    main()
