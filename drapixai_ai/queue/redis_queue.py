from __future__ import annotations

import redis
from rq import Queue

from drapixai_ai.configs.settings import settings


_redis_conn: redis.Redis | None = None
_queue: Queue | None = None


def get_redis() -> redis.Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = redis.Redis.from_url(settings.redis_url, decode_responses=False)
    return _redis_conn


def get_queue() -> Queue:
    global _queue
    if _queue is None:
        _queue = Queue(name=settings.queue_name, connection=get_redis())
    return _queue