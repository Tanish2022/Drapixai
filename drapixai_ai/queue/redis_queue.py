from __future__ import annotations

import redis
from rq import Queue

from drapixai_ai.configs.settings import settings


_redis_conn: redis.Redis | None = None
_queues: dict[str, Queue] = {}


def get_redis() -> redis.Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = redis.Redis.from_url(
            settings.redis_url,
            password=settings.redis_password or None,
            decode_responses=False,
        )
    return _redis_conn


def get_queue(name: str | None = None) -> Queue:
    queue_name = name or settings.queue_name
    if queue_name not in _queues:
        _queues[queue_name] = Queue(name=queue_name, connection=get_redis())
    return _queues[queue_name]
