from __future__ import annotations

import time
from typing import Any, Dict

from rq.job import Job

from drapixai_ai.configs.settings import settings
from drapixai_ai.limits.usage_limiter import UsageLimiter
from drapixai_ai.queue.redis_queue import get_queue
from drapixai_ai.worker.gpu_worker import run_tryon_job


class TryOnService:
    def __init__(self) -> None:
        self.limiter = UsageLimiter()
        self.queue = get_queue()

    def enqueue_tryon(
        self,
        user_id: str,
        person_b64: str,
        cloth_b64: str,
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
        if quality == "enhanced":
            steps = settings.enhanced_inference_steps
            guidance = settings.enhanced_guidance_scale

        payload: Dict[str, Any] = {
            "user_id": user_id,
            "person_image": person_b64,
            "cloth_image": cloth_b64,
            "quality": quality,
            "inference_steps": steps,
            "guidance_scale": guidance,
            "request_id": request_id,
            "garment_type": garment_type,
        }

        return self.queue.enqueue(
            run_tryon_job,
            payload,
            job_timeout=settings.job_timeout_seconds,
            result_ttl=settings.result_ttl_seconds,
        )

    def wait_for_result(self, job: Job) -> Dict[str, Any]:
        start = time.time()
        while time.time() - start < settings.max_wait_seconds:
            job.refresh()
            if job.is_failed:
                raise RuntimeError("TRY_ON_FAILED")
            if job.result is not None:
                return job.result
            time.sleep(settings.poll_interval_seconds)
        raise TimeoutError("TRY_ON_TIMEOUT")
