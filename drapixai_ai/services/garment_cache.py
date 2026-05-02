from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from drapixai_ai.configs.settings import settings
from drapixai_ai.queue.redis_queue import get_redis
from drapixai_ai.services.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class GarmentCacheHit:
    key: str
    image_bytes: bytes


class GarmentCache:
    PREPROCESS_VERSION = "v2"

    def __init__(self) -> None:
        self.base_dir = Path(settings.garment_cache_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.backend = settings.garment_cache_backend.lower()
        self.s3_client = None
        if self.backend == "s3":
            try:
                import boto3  # type: ignore
                self.s3_client = boto3.client(
                    "s3",
                    region_name=settings.s3_region,
                    endpoint_url=settings.s3_endpoint or None,
                    aws_access_key_id=settings.s3_access_key_id or None,
                    aws_secret_access_key=settings.s3_secret_access_key or None,
                )
            except Exception as exc:
                logger.error("s3_client_init_failed", extra={"error": str(exc)})
                self.backend = "local"

    @staticmethod
    def compute_hash(image_bytes: bytes) -> str:
        return hashlib.sha256(image_bytes).hexdigest()

    @staticmethod
    def build_key(
        image_hash: str,
        brand_id: Optional[str],
        garment_id: Optional[str],
        profile_key: Optional[str] = None,
    ) -> str:
        parts = []
        parts.append(GarmentCache.PREPROCESS_VERSION)
        if brand_id:
            parts.append(brand_id)
        if garment_id:
            parts.append(garment_id)
        if profile_key:
            parts.append(profile_key)
        parts.append(image_hash)
        return ":".join(parts)

    def _path_for_key(self, key: str) -> Path:
        safe_key = key.replace(":", "_").replace("/", "_")
        subdir = safe_key[:2]
        return self.base_dir / subdir / f"{safe_key}.png"

    def _s3_key_for_cache(self, key: str) -> str:
        safe_key = key.replace(":", "_").replace("/", "_")
        subdir = safe_key[:2]
        return f"garments/{subdir}/{safe_key}.png"

    def get(self, key: str) -> Optional[GarmentCacheHit]:
        redis = get_redis()
        path = redis.get(f"garment:{key}")
        if path:
            path_str = path.decode("utf-8")
            if path_str.startswith("s3://"):
                if self.s3_client is None:
                    return None
                _, _, rest = path_str.partition("s3://")
                bucket, _, obj_key = rest.partition("/")
                try:
                    resp = self.s3_client.get_object(Bucket=bucket, Key=obj_key)
                    return GarmentCacheHit(key=key, image_bytes=resp["Body"].read())
                except Exception as exc:
                    logger.warning("s3_cache_miss", extra={"error": str(exc), "key": key})
            else:
                if os.path.exists(path_str):
                    with open(path_str, "rb") as f:
                        return GarmentCacheHit(key=key, image_bytes=f.read())

        if self.backend == "s3" and self.s3_client is not None:
            obj_key = self._s3_key_for_cache(key)
            try:
                resp = self.s3_client.get_object(Bucket=settings.s3_bucket, Key=obj_key)
                return GarmentCacheHit(key=key, image_bytes=resp["Body"].read())
            except Exception:
                return None

        file_path = self._path_for_key(key)
        if file_path.exists():
            with open(file_path, "rb") as f:
                return GarmentCacheHit(key=key, image_bytes=f.read())
        return None

    def put(self, key: str, image_bytes: bytes) -> str:
        if self.backend == "s3" and self.s3_client is not None:
            obj_key = self._s3_key_for_cache(key)
            self.s3_client.put_object(
                Bucket=settings.s3_bucket,
                Key=obj_key,
                Body=image_bytes,
                ContentType="image/png",
            )
            s3_path = f"s3://{settings.s3_bucket}/{obj_key}"
            redis = get_redis()
            redis.setex(f"garment:{key}", settings.garment_cache_ttl_seconds, s3_path)
            return s3_path

        file_path = self._path_for_key(key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(image_bytes)

        redis = get_redis()
        redis.setex(f"garment:{key}", settings.garment_cache_ttl_seconds, str(file_path))
        return str(file_path)

    def health_check(self) -> dict:
        if self.backend == "s3" and self.s3_client is not None:
            test_key = f"garments/healthcheck/{os.getpid()}.txt"
            try:
                self.s3_client.put_object(
                    Bucket=settings.s3_bucket,
                    Key=test_key,
                    Body=b"ok",
                    ContentType="text/plain",
                )
                resp = self.s3_client.get_object(Bucket=settings.s3_bucket, Key=test_key)
                data = resp["Body"].read()
                self.s3_client.delete_object(Bucket=settings.s3_bucket, Key=test_key)
                return {"backend": "s3", "ok": data == b"ok"}
            except Exception as exc:
                return {"backend": "s3", "ok": False, "error": str(exc)}

        try:
            test_path = self.base_dir / "healthcheck.txt"
            test_path.write_text("ok", encoding="utf-8")
            ok = test_path.read_text(encoding="utf-8") == "ok"
            test_path.unlink(missing_ok=True)
            return {"backend": "local", "ok": ok}
        except Exception as exc:
            return {"backend": "local", "ok": False, "error": str(exc)}
