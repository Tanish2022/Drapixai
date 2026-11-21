from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

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
        return max(1, int((next_month - now).total_seconds()))

    def has_capacity(self, user_id: str) -> bool:
        key = self._month_key(user_id, datetime.now(timezone.utc))
        return int(self.redis.get(key) or 0) < settings.monthly_basic_limit

    def issue_demo_receipt(self) -> str:
        receipt = str(uuid4())
        self.redis.set(f"drapixai:tryon:public-demo:receipt:{receipt}", "pending", ex=600)
        return receipt

    def check_and_increment(self, user_id: str, *, demo_receipt: str | None = None) -> bool:
        now = datetime.now(timezone.utc)
        key = self._month_key(user_id, now)
        ttl = self._seconds_to_month_end(now)

        keys = [key]
        if demo_receipt is not None:
            keys.append(f"drapixai:tryon:public-demo:receipt:{demo_receipt}")
        lua = (
            "if KEYS[2] then "
            "  local state = redis.call('GET', KEYS[2]) "
            "  if state == 'settled' then return 0 end "
            "  if state ~= 'pending' then return -2 end "
            "end "
            "local current = redis.call('GET', KEYS[1]) "
            "if not current then current = 0 else current = tonumber(current) end "
            "if current + 1 > tonumber(ARGV[1]) then return -1 end "
            "current = redis.call('INCR', KEYS[1]) "
            "if current == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end "
            "if KEYS[2] then redis.call('SET', KEYS[2], 'settled', 'KEEPTTL') end "
            "return current"
        )

        result = self.redis.eval(lua, len(keys), *keys, settings.monthly_basic_limit, ttl)
        if result == -2:
            raise ValueError("DEMO_RECEIPT_EXPIRED")
        return result != -1
