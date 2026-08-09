from __future__ import annotations

import os
import sys
import tempfile
import time
import types
from pathlib import Path
from unittest.mock import patch

# Keep this release-gate regression dependency-free. The cache's Redis accessor
# is patched below, so these stubs are only needed while importing its module.
if "redis" not in sys.modules:
    redis_stub = types.ModuleType("redis")
    redis_stub.Redis = object
    sys.modules["redis"] = redis_stub
if "rq" not in sys.modules:
    rq_stub = types.ModuleType("rq")
    rq_stub.Queue = object
    sys.modules["rq"] = rq_stub

from drapixai_ai.configs.settings import settings
from drapixai_ai.services.garment_cache import GarmentCache


class MemoryRedis:
    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}

    def get(self, key: str):
        return self.values.get(key)

    def setex(self, key: str, _ttl: int, value: str) -> None:
        self.values[key] = value.encode("utf-8")

    def delete(self, key: str) -> int:
        return 1 if self.values.pop(key, None) is not None else 0


def main() -> None:
    redis = MemoryRedis()
    original_dir = settings.garment_cache_dir
    original_backend = settings.garment_cache_backend
    original_ttl = settings.garment_cache_ttl_seconds
    try:
        with tempfile.TemporaryDirectory(prefix="drapixai-cache-expiry-") as temporary_dir:
            object.__setattr__(settings, "garment_cache_dir", temporary_dir)
            object.__setattr__(settings, "garment_cache_backend", "local")
            object.__setattr__(settings, "garment_cache_ttl_seconds", 60)
            with patch("drapixai_ai.services.garment_cache.get_redis", return_value=redis):
                cache = GarmentCache()
                key = "v3:tenant:shirt:hash"
                stored_path = Path(cache.put(key, b"test-image"))
                old = time.time() - 61
                os.utime(stored_path, (old, old))
                assert cache.get(key) is None
                assert not stored_path.exists()
                assert f"garment:{key}" not in redis.values
    finally:
        object.__setattr__(settings, "garment_cache_dir", original_dir)
        object.__setattr__(settings, "garment_cache_backend", original_backend)
        object.__setattr__(settings, "garment_cache_ttl_seconds", original_ttl)

    print("Garment cache expiry validation passed.")


if __name__ == "__main__":
    main()
