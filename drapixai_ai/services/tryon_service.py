from __future__ import annotations

import base64
import time
from typing import Any, Dict

from rq.job import Job

from drapixai_ai.configs.settings import settings
from drapixai_ai.limits.usage_limiter import UsageLimiter
from drapixai_ai.queue.redis_queue import get_queue
from drapixai_ai.services.transient_spool import (
    cleanup_expired_transients,
    delete_transient,
    read_transient_bytes,
    write_transient_bytes,
)
from drapixai_ai.worker.gpu_worker import run_tryon_job


class TryOnService:
    def __init__(self) -> None:
        self.limiter = UsageLimiter()
        self.queue = get_queue()
        cleanup_expired_transients()

    def enqueue_tryon(
        self,
        user_id: str,
        person_bytes: bytes,
        cloth_bytes: bytes,
        quality: str | None = None,
        inference_steps: int | None = None,
        guidance_scale: float | None = None,
        request_id: str | None = None,
        garment_type: str | None = None,
    ) -> Job:
        allowed = self.limiter.check_and_increment(user_id)
        if not allowed:
            raise PermissionError("TRY_ON_LIMIT_EXCEEDED")

        steps = inference_steps
        guidance = guidance_scale

        person_ref = write_transient_bytes(person_bytes)
        cloth_ref: str | None = None
        try:
            cloth_ref = write_transient_bytes(cloth_bytes)
            payload: Dict[str, Any] = {
                "user_id": user_id,
                "person_image_ref": person_ref,
                "cloth_image_ref": cloth_ref,
                "quality": "standard",
                "inference_steps": steps,
                "guidance_scale": guidance,
                "request_id": request_id,
                "garment_type": garment_type,
                "enqueued_at_ms": int(time.time() * 1000),
            }

            return self.queue.enqueue(
                run_tryon_job,
                payload,
                job_timeout=settings.job_timeout_seconds,
                ttl=settings.queue_ttl_seconds,
                result_ttl=settings.result_ttl_seconds,
                failure_ttl=settings.failure_ttl_seconds,
            )
        except Exception:
            delete_transient(person_ref)
            delete_transient(cloth_ref)
            raise

    def wait_for_result(self, job: Job) -> Dict[str, Any]:
        start = time.time()
        while time.time() - start < settings.max_wait_seconds:
            job.refresh()
            if job.is_failed:
                self._cleanup_job_inputs(job)
                job.delete()
                raise RuntimeError("TRY_ON_FAILED")
            if job.result is not None:
                result = dict(job.result)
                output_ref = result.pop("output_image_ref", None)
                try:
                    if not output_ref:
                        raise RuntimeError("TRY_ON_OUTPUT_MISSING")
                    result["image_base64"] = base64.b64encode(
                        read_transient_bytes(output_ref)
                    ).decode("ascii")
                    return result
                finally:
                    delete_transient(output_ref)
                    job.delete()
            time.sleep(settings.poll_interval_seconds)
        job.refresh()
        if not job.is_started:
            job.cancel()
            self._cleanup_job_inputs(job)
            job.delete()
        raise TimeoutError("TRY_ON_TIMEOUT")

    @staticmethod
    def _cleanup_job_inputs(job: Job) -> None:
        args = job.args or ()
        payload = args[0] if args and isinstance(args[0], dict) else {}
        delete_transient(payload.get("person_image_ref"))
        delete_transient(payload.get("cloth_image_ref"))
