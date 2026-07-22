from __future__ import annotations

import base64
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image

APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", Path(__file__).resolve().parents[2]))
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline


def main() -> None:
    base = Path(os.getenv("DRAPIXAI_TEST_ASSET_DIR", APP_ROOT / "runtime" / "test_assets"))
    person = Image.open(base / "person.jpg").convert("RGB")

    garment_path = base / "garment.jpg"
    preprocess_path = base / "preprocess.json"
    if garment_path.exists():
        cloth_raw = Image.open(garment_path)
    elif preprocess_path.exists():
        preprocess_payload = json.loads(preprocess_path.read_text())
        cloth_raw = Image.open(io.BytesIO(base64.b64decode(preprocess_payload["image_base64"])))
    else:
        raise SystemExit(
            "Missing garment input. Put garment.jpg next to person.jpg, "
            "or provide preprocess.json with image_base64."
        )

    if cloth_raw.mode in ("RGBA", "LA"):
        rgba = cloth_raw.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        cloth = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        cloth = cloth_raw.convert("RGB")

    pipeline = DrapixAITryOnPipeline()
    result = pipeline.run_tryon_with_metadata(
        person,
        cloth,
        inference_steps=settings.inference_steps,
        guidance_scale=settings.guidance_scale,
        quality="standard",
    )

    output_path = base / "result_direct.png"
    result.image.save(output_path, format="PNG")
    metadata_path = base / "result_direct.json"
    metadata_path.write_text(
        json.dumps(
            {
                "engine": result.engine,
                "quality_score": result.quality_score,
                "candidate_count": result.candidate_count,
                "candidate_scores": result.candidate_scores,
                "warnings": result.warnings,
                "metadata": result.metadata,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(output_path)
    print(metadata_path)


if __name__ == "__main__":
    main()
