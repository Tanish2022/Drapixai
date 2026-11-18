from __future__ import annotations

import redis
from rq import Queue

from drapixai_ai.configs.settings import settings


_redis_conn: redis.Redis | None = None
_queues: dict[str, Queue] = {}


def _create_redis(socket_timeout: float | None) -> redis.Redis:
    pool = redis.ConnectionPool.from_url(
        settings.redis_url,
        password=settings.redis_password or None,
        decode_responses=False,
    )
    # from_url gives URL options precedence over keyword arguments.
    # Set the transport policy on the pool before its first connection.
    pool.connection_kwargs.update(
        socket_connect_timeout=2.0,
        socket_timeout=socket_timeout,
        retry_on_timeout=False,
        retry_on_error=[],
    )
    return redis.Redis(connection_pool=pool)


def get_redis() -> redis.Redis:
    global _redis_conn
    if _redis_conn is None:
        _redis_conn = _create_redis(socket_timeout=3.0)
    return _redis_conn


def create_worker_redis() -> redis.Redis:
    # RQ sets a finite read timeout longer than its blocking dequeue wait.
    # A worker owns this pool so that policy cannot affect API commands.
    return _create_redis(socket_timeout=None)


def get_queue(name: str | None = None) -> Queue:
    queue_name = name or settings.queue_name
    if queue_name not in _queues:
        _queues[queue_name] = Queue(name=queue_name, connection=get_redis())
    return _queues[queue_name]
