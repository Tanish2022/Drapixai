from __future__ import annotations

import base64
import time
from typing import Any, Dict

from redis.exceptions import ConnectionError as RedisConnectionError, TimeoutError as RedisTimeoutError
from redis.exceptions import RedisError
from rq.job import Job, JobStatus

from drapixai_ai.configs.settings import settings
from drapixai_ai.limits.usage_limiter import UsageLimiter
from drapixai_ai.queue.redis_queue import get_queue
from drapixai_ai.services.logger import get_logger
from drapixai_ai.services.transient_spool import (
    cleanup_expired_transients,
    delete_transient,
    read_transient_bytes,
    write_transient_bytes,
)
from drapixai_ai.worker.gpu_worker import run_tryon_job
from drapixai_ai.services.admission_protocol import TryOnLimitExceeded, TryOnPreDispatchFailure, TryOnTerminalFailure

logger = get_logger(__name__)


class TryOnService:
    def __init__(self) -> None:
        self.limiter = UsageLimiter()
        self.upper_queue = get_queue(settings.queue_name)
        self.lower_queue = get_queue(settings.lower_body_queue_name)
        cleanup_expired_transients()

    @staticmethod
    def _is_lower_body(garment_type: str | None) -> bool:
        normalized = (garment_type or "upper").strip().lower().replace("-", "_")
        return normalized in {"lower", "lower_body"} or normalized.startswith(
            ("lower:", "lower_body:")
        )

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
        *,
        subscription_quota_reserved: bool = False,
        defer_demo_quota: bool = False,
    ) -> Job:
        # Direct and demo calls use the local guard. API-dispatched work is
        # accounted for by the tenant's subscription reservation ledger.
        count_local_quota = not subscription_quota_reserved
        if count_local_quota:
            try:
                has_capacity = self.limiter.has_capacity(user_id)
            except (RedisError, ValueError) as exc:
                raise TryOnPreDispatchFailure("TRY_ON_QUEUE_UNAVAILABLE") from exc
            if not has_capacity:
                raise TryOnLimitExceeded("TRY_ON_LIMIT_EXCEEDED")

        steps = inference_steps
        guidance = guidance_scale

        person_ref: str | None = None
        try:
            person_ref = write_transient_bytes(person_bytes)
            cloth_ref = write_transient_bytes(cloth_bytes)
        except (OSError, ValueError) as exc:
            self._discard_spool_file(person_ref)
            raise TryOnPreDispatchFailure("TRY_ON_SPOOL_FAILED") from exc
        try:
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
                "count_local_quota_on_result": count_local_quota and not defer_demo_quota,
            }

            queue = self.lower_queue if self._is_lower_body(garment_type) else self.upper_queue
            return queue.enqueue(
                run_tryon_job,
                payload,
                job_timeout=settings.job_timeout_seconds,
                ttl=settings.queue_ttl_seconds,
                result_ttl=settings.result_ttl_seconds,
                failure_ttl=settings.failure_ttl_seconds,
            )
        except (RedisConnectionError, RedisTimeoutError):
            # The queue may have accepted the job before the connection failed.
            # Keep its inputs available to the worker and the existing spool reaper.
            raise
        except Exception:
            self._discard_spool_file(person_ref)
            self._discard_spool_file(cloth_ref)
            raise

    def wait_for_result(self, job: Job) -> Dict[str, Any]:
        deadline = time.monotonic() + settings.max_wait_seconds
        while True:
            final_poll = time.monotonic() >= deadline
            job.refresh()
            status = job.get_status(refresh=False)
            if status == JobStatus.FAILED:
                self._cleanup_job_inputs(job)
                self._discard_terminal_job(job)
                raise TryOnTerminalFailure("TRY_ON_FAILED")
            job_result = job.result
            if status == JobStatus.FINISHED and job_result is None:
                self._discard_terminal_job(job)
                raise TryOnTerminalFailure("TRY_ON_OUTPUT_MISSING")
            if job_result is not None:
                result = dict(job_result)
                output_ref = result.pop("output_image_ref", None)
                try:
                    if not output_ref:
                        raise TryOnTerminalFailure("TRY_ON_OUTPUT_MISSING")
                    try:
                        image_bytes = read_transient_bytes(output_ref)
                    except (OSError, ValueError) as exc:
                        raise TryOnTerminalFailure("TRY_ON_OUTPUT_MISSING") from exc
                    result["image_base64"] = base64.b64encode(image_bytes).decode("ascii")
                    payload = self._job_payload(job)
                    # Jobs from an older worker/API release were charged at
                    # enqueue. Only the new marker opts in to result charging.
                    if payload.get("count_local_quota_on_result") is True:
                        try:
                            charged = self.limiter.check_and_increment(payload["user_id"])
                        except RedisError as exc:
                            raise TryOnTerminalFailure("TRY_ON_USAGE_UNAVAILABLE") from exc
                        if not charged:
                            raise TryOnLimitExceeded("TRY_ON_LIMIT_EXCEEDED")
                    return result
                finally:
                    self._discard_spool_file(output_ref)
                    self._discard_terminal_job(job)
            if final_poll:
                # A worker may have dequeued the job before marking it started.
                # Leave unresolved work to RQ and the transient spool reaper.
                raise TimeoutError("TRY_ON_TIMEOUT")
            remaining = deadline - time.monotonic()
            if remaining > 0:
                time.sleep(min(settings.poll_interval_seconds, remaining))

    @staticmethod
    def _job_payload(job: Job) -> dict:
        args = job.args or ()
        return args[0] if args and isinstance(args[0], dict) else {}

    def _cleanup_job_inputs(self, job: Job) -> None:
        payload = self._job_payload(job)
        self._discard_spool_file(payload.get("person_image_ref"))
        self._discard_spool_file(payload.get("cloth_image_ref"))

    @staticmethod
    def _discard_spool_file(reference: str | None) -> None:
        if not reference:
            return
        try:
            delete_transient(reference)
        except OSError:
            logger.warning("transient_spool_delete_failed")

    @staticmethod
    def _discard_terminal_job(job: Job) -> None:
        try:
            job.delete()
        except RedisError:
            logger.warning("terminal_tryon_job_delete_failed")
