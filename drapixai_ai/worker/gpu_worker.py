from __future__ import annotations

import base64
import io
import os
import sys
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

if __name__ == "__main__" and __spec__ and __spec__.name:
    sys.modules.setdefault(__spec__.name, sys.modules[__name__])


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
    job_started_at_ms = int(time.time() * 1000)
    total_start = time.perf_counter()
    decode_start = time.perf_counter()
    pipeline = _get_pipeline()

    person = _decode_image(payload["person_image"])
    cloth = _decode_image(payload["cloth_image"], preserve_white_background=True)
    decode_ms = int((time.perf_counter() - decode_start) * 1000)

    logger.info(
        "job_start",
        extra={
            "user_id": payload.get("user_id"),
            "inference_steps": payload.get("inference_steps"),
            "guidance_scale": payload.get("guidance_scale"),
            "request_id": payload.get("request_id"),
            "garment_type": payload.get("garment_type"),
            "quality": payload.get("quality"),
        },
    )
    pipeline_start = time.perf_counter()
    result = pipeline.run_tryon_with_metadata(
        person,
        cloth,
        inference_steps=payload.get("inference_steps"),
        guidance_scale=payload.get("guidance_scale"),
        garment_type=payload.get("garment_type"),
        quality=payload.get("quality"),
    )
    pipeline_ms = int((time.perf_counter() - pipeline_start) * 1000)
    encode_start = time.perf_counter()
    image_base64 = _encode_image(result.image)
    encode_ms = int((time.perf_counter() - encode_start) * 1000)
    total_ms = int((time.perf_counter() - total_start) * 1000)
    enqueued_at_ms = payload.get("enqueued_at_ms")
    queue_wait_ms = (
        max(0, job_started_at_ms - int(enqueued_at_ms))
        if isinstance(enqueued_at_ms, (int, float))
        else None
    )
    timings = {
        **dict(result.metadata.get("timings", {})),
        "decode_ms": decode_ms,
        "worker_pipeline_ms": pipeline_ms,
        "encode_ms": encode_ms,
        "worker_total_ms": total_ms,
    }
    if queue_wait_ms is not None:
        timings["queue_wait_ms"] = queue_wait_ms
    warnings = list(result.warnings)
    if total_ms > settings.target_tryon_ms:
        warnings = sorted(set([*warnings, "LATENCY_BUDGET_EXCEEDED"]))
        logger.warning(
            "latency_budget_exceeded",
            extra={
                "user_id": payload.get("user_id"),
                "request_id": payload.get("request_id"),
                "quality": payload.get("quality"),
                "processing_ms": total_ms,
                "target_tryon_ms": settings.target_tryon_ms,
                "timings": timings,
            },
        )
    logger.info(
        "job_complete",
        extra={
            "user_id": payload.get("user_id"),
            "request_id": payload.get("request_id"),
            "engine": result.engine,
            "quality_score": result.quality_score,
            "candidate_count": result.candidate_count,
            "warnings": warnings,
            "quality": payload.get("quality"),
            "timings": timings,
        },
    )

    return {
        "image_base64": image_base64,
        "format": settings.output_format,
        "engine": result.engine,
        "quality_score": result.quality_score,
        "candidate_count": result.candidate_count,
        "candidate_scores": result.candidate_scores,
        "warnings": warnings,
        "timings": timings,
        "processing_ms": total_ms,
        "metadata": {**result.metadata, "timings": timings},
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
