from __future__ import annotations

import base64
import io
import os
import time
from typing import Any, Dict

import torch
from PIL import Image
from rq import SimpleWorker, Worker
from rq.timeouts import TimerDeathPenalty

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.queue.redis_queue import get_queue, get_redis
from drapixai_ai.services.logger import get_logger


_PIPELINE: DrapixAITryOnPipeline | None = None
logger = get_logger("drapixai_ai.worker")


class WindowsSimpleWorker(SimpleWorker):
    death_penalty_class = TimerDeathPenalty


class CUDASimpleWorker(SimpleWorker):
    death_penalty_class = TimerDeathPenalty


def _get_pipeline() -> DrapixAITryOnPipeline:
    global _PIPELINE
    if _PIPELINE is None:
        logger.info("loading_model")
        _PIPELINE = DrapixAITryOnPipeline()
        if settings.low_vram_mode:
            logger.info("warmup_skipped_low_vram")
        else:
            try:
                from PIL import Image
                dummy = Image.new("RGB", (settings.input_max_side, settings.input_max_side), color=(0, 0, 0))
                _PIPELINE.run_tryon(dummy, dummy, inference_steps=1, guidance_scale=1.0)
                logger.info("warmup_complete")
            except Exception:
                logger.info("warmup_failed")
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
        logger.info("model_loaded")
    return _PIPELINE


def _decode_image(data_b64: str, *, preserve_white_background: bool = False) -> Image.Image:
    raw = base64.b64decode(data_b64)
    image = Image.open(io.BytesIO(raw))
    if preserve_white_background and image.mode in ("RGBA", "LA"):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")
    return image.convert("RGB")


def _encode_image(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format=settings.output_format.upper())
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def run_tryon_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    pipeline = _get_pipeline()

    person = _decode_image(payload["person_image"])
    cloth = _decode_image(payload["cloth_image"], preserve_white_background=True)

    logger.info(
        "job_start",
        extra={
            "user_id": payload.get("user_id"),
            "inference_steps": payload.get("inference_steps"),
            "guidance_scale": payload.get("guidance_scale"),
            "request_id": payload.get("request_id"),
            "garment_type": payload.get("garment_type"),
        },
    )
    result = pipeline.run_tryon(
        person,
        cloth,
        inference_steps=payload.get("inference_steps"),
        guidance_scale=payload.get("guidance_scale"),
    )
    logger.info(
        "job_complete",
        extra={"user_id": payload.get("user_id"), "request_id": payload.get("request_id")},
    )

    return {
        "image_base64": _encode_image(result),
        "format": settings.output_format,
    }


def main() -> None:
    use_cuda = settings.device == "cuda" and torch.cuda.is_available()
    if use_cuda:
        torch.cuda.set_device(settings.cuda_device_index)

    if settings.preload_model_on_start:
        logger.info("preloading_pipeline")
        _get_pipeline()

    queue = get_queue()
    if use_cuda:
        # CUDA inference cannot be re-initialized safely in RQ's forked worker subprocesses.
        worker_cls = CUDASimpleWorker
    else:
        worker_cls = WindowsSimpleWorker if os.name == "nt" else Worker
    worker = worker_cls([queue], connection=get_redis())
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
