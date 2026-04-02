from __future__ import annotations

from datetime import datetime, timezone

from drapixai_ai.configs.settings import settings
from drapixai_ai.queue.redis_queue import get_redis


class UsageLimiter:
    def __init__(self) -> None:
        self.redis = get_redis()

    @staticmethod
    def _month_key(user_id: str, now: datetime) -> str:
        return f"drapixai:tryon:{user_id}:{now.year}{now.month:02d}"

    @staticmethod
    def _seconds_to_month_end(now: datetime) -> int:
        if now.month == 12:
            next_month = datetime(now.year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            next_month = datetime(now.year, now.month + 1, 1, tzinfo=timezone.utc)
        return int((next_month - now).total_seconds())

    def check_and_increment(self, user_id: str) -> bool:
        now = datetime.now(timezone.utc)
        key = self._month_key(user_id, now)
        ttl = self._seconds_to_month_end(now)

        lua = (
            "local current = redis.call('GET', KEYS[1]) "
            "if not current then current = 0 else current = tonumber(current) end "
            "if current + 1 > tonumber(ARGV[1]) then return -1 end "
            "current = redis.call('INCR', KEYS[1]) "
            "if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end "
            "return current"
        )

        result = self.redis.eval(lua, 1, key, settings.monthly_basic_limit, ttl)
        return result != -1