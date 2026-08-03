from __future__ import annotations

import io
import os
import sys
import time
import traceback
from typing import Any, Dict, Sequence

import torch
from PIL import Image, ImageFilter
from rq import SimpleWorker, Worker
from rq.connections import pop_connection, push_connection
from rq.timeouts import JobTimeoutException, TimerDeathPenalty
from rq.utils import utcnow

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.queue.redis_queue import get_queue, get_redis
from drapixai_ai.services.logger import get_logger
from drapixai_ai.services.transient_spool import (
    cleanup_expired_transients,
    delete_transient,
    read_transient_bytes,
    write_transient_bytes,
)


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
        _PIPELINE.preload(settings.worker_role)
        if settings.low_vram_mode:
            logger.info("warmup_skipped_low_vram")
        else:
            try:
                from PIL import Image
                dummy = Image.new("RGB", (settings.input_max_side, settings.input_max_side), color=(0, 0, 0))
                warmup_type = "lower:pants" if settings.worker_role.strip().lower() == "lower" else "upper"
                _PIPELINE.run_tryon(
                    dummy,
                    dummy,
                    inference_steps=1,
                    guidance_scale=1.0,
                    garment_type=warmup_type,
                )
                logger.info("warmup_complete")
            except Exception:
                logger.info("warmup_failed")
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
        logger.info("model_loaded")
    return _PIPELINE


def _decode_image(reference: str, *, preserve_white_background: bool = False) -> Image.Image:
    raw = read_transient_bytes(reference)
    image = Image.open(io.BytesIO(raw))
    width, height = image.size
    if width <= 0 or height <= 0 or width * height > settings.request_max_pixels:
        raise ValueError("IMAGE_PIXEL_LIMIT")
    if preserve_white_background and image.mode in ("RGBA", "LA"):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        return Image.alpha_composite(background, rgba).convert("RGB")
    return image.convert("RGB")


def _store_output_image(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format=settings.output_format.upper())
    return write_transient_bytes(buf.getvalue())


def _finalize_output_image(image: Image.Image) -> Image.Image:
    if not settings.enable_final_output_upscale:
        return image
    target_size = (settings.output_width, settings.output_height)
    if image.size == target_size:
        return image
    resized = image.resize(target_size, Image.Resampling.LANCZOS)
    return resized.filter(ImageFilter.UnsharpMask(radius=0.7, percent=35, threshold=4))


def _decode_payload(payload: Dict[str, Any]) -> tuple[Image.Image, Image.Image]:
    decode_start = time.perf_counter()
    person_ref = payload.get("person_image_ref")
    cloth_ref = payload.get("cloth_image_ref")
    try:
        person = _decode_image(person_ref)
        cloth = _decode_image(cloth_ref, preserve_white_background=True)
    finally:
        delete_transient(person_ref)
        delete_transient(cloth_ref)
    payload["_decode_ms"] = int((time.perf_counter() - decode_start) * 1000)
    return person, cloth


def _log_job_start(payload: Dict[str, Any]) -> None:
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


def _gpu_memory_metrics() -> dict[str, int | float]:
    if not torch.cuda.is_available():
        return {}
    device = settings.cuda_device_index
    try:
        total = int(torch.cuda.get_device_properties(device).total_memory)
        peak_allocated = int(torch.cuda.max_memory_allocated(device))
        peak_reserved = int(torch.cuda.max_memory_reserved(device))
    except (RuntimeError, ValueError):
        logger.warning("gpu_memory_metrics_unavailable")
        return {}
    headroom_ratio = max(0.0, (total - peak_reserved) / max(1, total))
    mib = 1024 * 1024
    return {
        "gpu_peak_allocated_mb": peak_allocated // mib,
        "gpu_peak_reserved_mb": peak_reserved // mib,
        "gpu_total_mb": total // mib,
        "gpu_headroom_ratio": round(headroom_ratio, 4),
    }


def _serialize_result(
    payload: Dict[str, Any],
    result,
    *,
    total_start: float,
    job_started_at_ms: int,
    pipeline_ms: int,
    batch_size: int,
    memory_metrics: dict[str, int | float],
    fallback_warning: str | None = None,
) -> Dict[str, Any]:
    encode_start = time.perf_counter()
    output_image = _finalize_output_image(result.image)
    output_upscale_ms = int((time.perf_counter() - encode_start) * 1000)
    encode_start = time.perf_counter()
    output_image_ref = _store_output_image(output_image)
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
        "decode_ms": int(payload.get("_decode_ms", 0)),
        "worker_pipeline_ms": pipeline_ms,
        "output_upscale_ms": output_upscale_ms,
        "encode_ms": encode_ms,
        "worker_total_ms": total_ms,
        "worker_batch_size": batch_size,
    }
    timings.update(memory_metrics)
    if queue_wait_ms is not None:
        timings["queue_wait_ms"] = queue_wait_ms
    warnings = list(result.warnings)
    if fallback_warning:
        warnings = sorted(set([*warnings, fallback_warning]))
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
        "output_image_ref": output_image_ref,
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


def _run_tryon_payload_batch(
    payloads: Sequence[Dict[str, Any]],
) -> list[Dict[str, Any] | Exception]:
    cleanup_expired_transients()
    pipeline = _get_pipeline()
    started_at_ms = int(time.time() * 1000)
    total_starts = [time.perf_counter() for _ in payloads]
    outputs: list[Dict[str, Any] | Exception] = [
        RuntimeError("TRY_ON_NOT_PROCESSED") for _ in payloads
    ]
    valid_indices: list[int] = []
    persons: list[Image.Image] = []
    cloths: list[Image.Image] = []

    for index, payload in enumerate(payloads):
        _log_job_start(payload)
        try:
            person, cloth = _decode_payload(payload)
        except Exception as exc:
            outputs[index] = exc
            continue
        valid_indices.append(index)
        persons.append(person)
        cloths.append(cloth)

    if not valid_indices:
        return outputs

    if torch.cuda.is_available():
        try:
            torch.cuda.reset_peak_memory_stats(settings.cuda_device_index)
        except (RuntimeError, ValueError):
            logger.warning("gpu_memory_metrics_reset_unavailable")

    valid_payloads = [payloads[index] for index in valid_indices]
    inference_steps = valid_payloads[0].get("inference_steps")
    guidance_scale = valid_payloads[0].get("guidance_scale")
    pipeline_start = time.perf_counter()
    fallback_warning = None
    try:
        if len(valid_indices) == 1:
            payload = valid_payloads[0]
            results = [
                pipeline.run_tryon_with_metadata(
                    persons[0],
                    cloths[0],
                    inference_steps=payload.get("inference_steps"),
                    guidance_scale=payload.get("guidance_scale"),
                    garment_type=payload.get("garment_type"),
                    quality=payload.get("quality"),
                )
            ]
        else:
            results = pipeline.run_tryon_batch_with_metadata(
                persons,
                cloths,
                inference_steps=inference_steps,
                guidance_scale=guidance_scale,
                garment_types=[
                    payload.get("garment_type") for payload in valid_payloads
                ],
                qualities=[payload.get("quality") for payload in valid_payloads],
            )
    except torch.OutOfMemoryError as exc:
        if not settings.batch_oom_fallback:
            for index in valid_indices:
                outputs[index] = exc
            return outputs
        logger.warning(
            "gpu_batch_oom_fallback",
            extra={"batch_size": len(valid_indices)},
        )
        torch.cuda.empty_cache()
        fallback_warning = "BATCH_OOM_FALLBACK"
        results = [
            pipeline.run_tryon_with_metadata(
                person,
                cloth,
                inference_steps=payload.get("inference_steps"),
                guidance_scale=payload.get("guidance_scale"),
                garment_type=payload.get("garment_type"),
                quality=payload.get("quality"),
            )
            for person, cloth, payload in zip(persons, cloths, valid_payloads)
        ]
    except Exception:
        logger.exception(
            "gpu_batch_execution_fallback",
            extra={"batch_size": len(valid_indices)},
        )
        fallback_warning = "BATCH_EXECUTION_FALLBACK"
        try:
            results = [
                pipeline.run_tryon_with_metadata(
                    person,
                    cloth,
                    inference_steps=payload.get("inference_steps"),
                    guidance_scale=payload.get("guidance_scale"),
                    garment_type=payload.get("garment_type"),
                    quality=payload.get("quality"),
                )
                for person, cloth, payload in zip(persons, cloths, valid_payloads)
            ]
        except Exception as exc:
            for index in valid_indices:
                outputs[index] = exc
            return outputs

    pipeline_ms = int((time.perf_counter() - pipeline_start) * 1000)
    memory_metrics = _gpu_memory_metrics()
    headroom_ratio = memory_metrics.get("gpu_headroom_ratio")
    if (
        isinstance(headroom_ratio, (int, float))
        and headroom_ratio < settings.batch_vram_headroom_ratio
    ):
        logger.warning(
            "gpu_batch_headroom_below_target",
            extra={
                "batch_size": len(valid_indices),
                "gpu_headroom_ratio": headroom_ratio,
                "target_headroom_ratio": settings.batch_vram_headroom_ratio,
            },
        )
    for payload_index, result in zip(valid_indices, results):
        try:
            outputs[payload_index] = _serialize_result(
                payloads[payload_index],
                result,
                total_start=total_starts[payload_index],
                job_started_at_ms=started_at_ms,
                pipeline_ms=pipeline_ms,
                batch_size=len(valid_indices),
                memory_metrics=memory_metrics,
                fallback_warning=fallback_warning,
            )
        except Exception as exc:
            outputs[payload_index] = exc
    return outputs


def run_tryon_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    result = _run_tryon_payload_batch([payload])[0]
    if isinstance(result, Exception):
        raise result
    return result


class AdaptiveBatchWorker(CUDASimpleWorker):
    """RQ worker that executes up to three try-on jobs in one GPU call."""

    @staticmethod
    def _is_tryon_job(job) -> bool:
        return bool(job.func_name and job.func_name.endswith("run_tryon_job"))

    @staticmethod
    def _payload(job) -> Dict[str, Any] | None:
        args = job.args or ()
        if not args or not isinstance(args[0], dict):
            return None
        return args[0]

    @staticmethod
    def _compatibility_key(payload: Dict[str, Any]) -> tuple[Any, ...]:
        garment_type = str(payload.get("garment_type") or "upper").lower()
        garment_family = "lower" if garment_type.startswith("lower") else "upper"
        return (
            garment_family,
            payload.get("quality") or "standard",
            payload.get("inference_steps") or settings.inference_steps,
            payload.get("guidance_scale") or settings.guidance_scale,
        )

    def _return_to_queue(self, job, queue) -> None:
        self.connection.lrem(queue.intermediate_queue_key, 1, job.id)
        queue.enqueue_job(job, at_front=True)

    def _collect_jobs(self, first_job, queue) -> list[Any]:
        jobs = [first_job]
        first_payload = self._payload(first_job)
        if first_payload is None:
            return jobs
        compatibility_key = self._compatibility_key(first_payload)
        deadline = time.perf_counter() + settings.batch_wait_ms / 1000
        while len(jobs) < settings.gpu_batch_max:
            dequeued = self.queue_class.dequeue_any(
                [queue],
                timeout=None,
                connection=self.connection,
                job_class=self.job_class,
                serializer=self.serializer,
                death_penalty_class=self.death_penalty_class,
            )
            if dequeued is None:
                if time.perf_counter() >= deadline:
                    break
                time.sleep(0.01)
                continue
            next_job, _ = dequeued
            next_payload = self._payload(next_job)
            if (
                not self._is_tryon_job(next_job)
                or next_payload is None
                or self._compatibility_key(next_payload) != compatibility_key
            ):
                self._return_to_queue(next_job, queue)
                break
            jobs.append(next_job)
        return jobs

    def _complete_success(self, job, result, queue, registry) -> None:
        job.ended_at = utcnow()
        job._result = result
        job.heartbeat(utcnow(), job.success_callback_timeout)
        job.execute_success_callback(self.death_penalty_class, result)
        self.handle_job_success(
            job=job,
            queue=queue,
            started_job_registry=registry,
        )

    def _complete_failure(self, job, exc: Exception, queue, registry) -> None:
        job.ended_at = utcnow()
        exc_info = (type(exc), exc, exc.__traceback__)
        exc_string = "".join(traceback.format_exception(*exc_info))
        try:
            job.heartbeat(utcnow(), job.failure_callback_timeout)
            job.execute_failure_callback(self.death_penalty_class, *exc_info)
        except Exception:
            exc_info = sys.exc_info()
            exc_string = "".join(traceback.format_exception(*exc_info))
        self.handle_job_failure(
            job=job,
            exc_string=exc_string,
            queue=queue,
            started_job_registry=registry,
        )
        self.handle_exception(job, *exc_info)

    def perform_job(self, job, queue) -> bool:
        if not settings.adaptive_batching or not self._is_tryon_job(job):
            return super().perform_job(job, queue)

        jobs = self._collect_jobs(job, queue)
        payloads = [self._payload(item) for item in jobs]
        if any(payload is None for payload in payloads):
            return super().perform_job(job, queue)

        push_connection(self.connection)
        registry = queue.started_job_registry
        try:
            for item in jobs:
                self.prepare_job_execution(
                    item,
                    remove_from_intermediate_queue=len(self.queues) == 1,
                )
                item.started_at = utcnow()
            timeout = max(
                item.timeout or self.queue_class.DEFAULT_TIMEOUT for item in jobs
            )
            with self.death_penalty_class(
                timeout,
                JobTimeoutException,
                job_id=job.id,
            ):
                results = _run_tryon_payload_batch(payloads)  # type: ignore[arg-type]
            for item, result in zip(jobs, results):
                if isinstance(result, Exception):
                    self._complete_failure(item, result, queue, registry)
                else:
                    self._complete_success(item, result, queue, registry)
        except Exception as exc:
            logger.exception(
                "adaptive_batch_worker_failed",
                extra={"batch_size": len(jobs)},
            )
            for item in jobs:
                if item.ended_at is None:
                    self._complete_failure(item, exc, queue, registry)
            return False
        finally:
            pop_connection()
        logger.info("adaptive_batch_complete", extra={"batch_size": len(jobs)})
        return True


def main() -> None:
    cleanup_expired_transients()
    use_cuda = settings.device == "cuda" and torch.cuda.is_available()
    if use_cuda:
        torch.cuda.set_device(settings.cuda_device_index)

    if settings.preload_model_on_start:
        logger.info("preloading_pipeline")
        _get_pipeline()

    role = settings.worker_role.strip().lower()
    if role == "upper":
        queues = [get_queue(settings.queue_name)]
    elif role == "lower":
        queues = [get_queue(settings.lower_body_queue_name)]
    elif role == "both":
        queues = [
            get_queue(settings.queue_name),
            get_queue(settings.lower_body_queue_name),
        ]
    else:
        raise ValueError(f"UNSUPPORTED_WORKER_ROLE:{settings.worker_role}")
    if use_cuda:
        # CUDA inference cannot be re-initialized safely in RQ's forked worker subprocesses.
        worker_cls = AdaptiveBatchWorker if settings.adaptive_batching else CUDASimpleWorker
    else:
        worker_cls = WindowsSimpleWorker if os.name == "nt" else Worker
    worker = worker_cls(queues, connection=get_redis())
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
