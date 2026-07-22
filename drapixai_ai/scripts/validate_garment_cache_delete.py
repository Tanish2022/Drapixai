from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

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
    try:
        with tempfile.TemporaryDirectory(prefix="drapixai-cache-delete-") as temporary_dir:
            object.__setattr__(settings, "garment_cache_dir", temporary_dir)
            object.__setattr__(settings, "garment_cache_backend", "local")
            with patch("drapixai_ai.services.garment_cache.get_redis", return_value=redis):
                cache = GarmentCache()
                key = "v3:test:shopify-1:shirt:hash"
                stored_path = Path(cache.put(key, b"test-image"))
                assert stored_path.is_file()
                assert cache.get(key) is not None
                assert cache.delete(key) is True
                assert not stored_path.exists()
                assert cache.get(key) is None
                assert f"garment:{key}" not in redis.values
    finally:
        object.__setattr__(settings, "garment_cache_dir", original_dir)
        object.__setattr__(settings, "garment_cache_backend", original_backend)

    print("Garment cache deletion validation passed.")


if __name__ == "__main__":
    main()
