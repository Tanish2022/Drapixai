from __future__ import annotations

import hashlib
import os
import time
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
        version: Optional[str] = None,
    ) -> str:
        parts = []
        parts.append(version or settings.garment_cache_version or GarmentCache.PREPROCESS_VERSION)
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

    @staticmethod
    def _redis_key(key: str) -> str:
        return f"garment:{key}"

    @staticmethod
    def _ttl_seconds() -> int:
        return max(1, int(settings.garment_cache_ttl_seconds))

    def _is_expired(self, modified_at: float) -> bool:
        return modified_at + self._ttl_seconds() <= time.time()

    def _delete_redis_pointer(self, key: str) -> None:
        try:
            get_redis().delete(self._redis_key(key))
        except Exception as exc:
            logger.warning("garment_cache_redis_cleanup_failed", extra={"error": str(exc), "key": key})

    def _read_local_if_fresh(self, key: str, file_path: Path) -> Optional[GarmentCacheHit]:
        try:
            if not file_path.is_file():
                return None
            if self._is_expired(file_path.stat().st_mtime):
                file_path.unlink(missing_ok=True)
                self._delete_redis_pointer(key)
                logger.info("garment_cache_expired", extra={"backend": "local", "key": key})
                return None
            with open(file_path, "rb") as file:
                return GarmentCacheHit(key=key, image_bytes=file.read())
        except FileNotFoundError:
            return None
        except Exception as exc:
            logger.warning("local_cache_read_failed", extra={"error": str(exc), "key": key})
            return None

    def _read_s3_if_fresh(self, key: str, bucket: str, object_key: str) -> Optional[GarmentCacheHit]:
        if self.s3_client is None:
            return None
        try:
            head = self.s3_client.head_object(Bucket=bucket, Key=object_key)
            metadata = head.get("Metadata", {}) or {}
            expires_at = metadata.get("drapixai-expires-at")
            expired = False
            if expires_at and expires_at.isdigit():
                expired = int(expires_at) <= int(time.time())
            else:
                last_modified = head.get("LastModified")
                expired = not last_modified or self._is_expired(last_modified.timestamp())
            if expired:
                self.s3_client.delete_object(Bucket=bucket, Key=object_key)
                self._delete_redis_pointer(key)
                logger.info("garment_cache_expired", extra={"backend": "s3", "key": key})
                return None
            response = self.s3_client.get_object(Bucket=bucket, Key=object_key)
            return GarmentCacheHit(key=key, image_bytes=response["Body"].read())
        except Exception as exc:
            logger.warning("s3_cache_miss", extra={"error": str(exc), "key": key})
            return None

    def get(self, key: str) -> Optional[GarmentCacheHit]:
        redis = get_redis()
        path = redis.get(self._redis_key(key))
        if path:
            path_str = path.decode("utf-8")
            if path_str.startswith("s3://"):
                if self.s3_client is None:
                    return None
                _, _, rest = path_str.partition("s3://")
                bucket, _, obj_key = rest.partition("/")
                hit = self._read_s3_if_fresh(key, bucket, obj_key)
                if hit:
                    return hit
            else:
                hit = self._read_local_if_fresh(key, Path(path_str))
                if hit:
                    return hit

        if self.backend == "s3" and self.s3_client is not None:
            obj_key = self._s3_key_for_cache(key)
            return self._read_s3_if_fresh(key, settings.s3_bucket, obj_key)

        return self._read_local_if_fresh(key, self._path_for_key(key))

    def put(self, key: str, image_bytes: bytes) -> str:
        if self.backend == "s3" and self.s3_client is not None:
            obj_key = self._s3_key_for_cache(key)
            self.s3_client.put_object(
                Bucket=settings.s3_bucket,
                Key=obj_key,
                Body=image_bytes,
                ContentType="image/png",
                Metadata={"drapixai-expires-at": str(int(time.time()) + self._ttl_seconds())},
            )
            s3_path = f"s3://{settings.s3_bucket}/{obj_key}"
            redis = get_redis()
            redis.setex(self._redis_key(key), self._ttl_seconds(), s3_path)
            return s3_path

        file_path = self._path_for_key(key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(image_bytes)

        redis = get_redis()
        redis.setex(self._redis_key(key), self._ttl_seconds(), str(file_path))
        return str(file_path)

    def delete(self, key: str) -> bool:
        removed = False
        redis = get_redis()

        if self.s3_client is not None:
            try:
                self.s3_client.delete_object(
                    Bucket=settings.s3_bucket,
                    Key=self._s3_key_for_cache(key),
                )
                removed = True
            except Exception as exc:
                logger.warning("s3_cache_delete_failed", extra={"error": str(exc), "key": key})
                raise

        file_path = self._path_for_key(key)
        if file_path.exists():
            file_path.unlink()
            removed = True

        redis.delete(self._redis_key(key))
        return removed

    def purge_expired(self, limit: int = 1_000) -> dict[str, int | str]:
        """Delete stale physical cache assets. Run on a schedule, never on request paths."""
        bounded_limit = max(1, min(int(limit), 10_000))
        scanned = 0
        removed = 0
        if self.backend == "s3" and self.s3_client is not None:
            try:
                response = self.s3_client.list_objects_v2(
                    Bucket=settings.s3_bucket,
                    Prefix="garments/",
                    MaxKeys=bounded_limit,
                )
                expired_keys = [
                    {"Key": item["Key"]}
                    for item in response.get("Contents", [])
                    if item.get("LastModified") and self._is_expired(item["LastModified"].timestamp())
                ]
                scanned = len(response.get("Contents", []))
                if expired_keys:
                    self.s3_client.delete_objects(Bucket=settings.s3_bucket, Delete={"Objects": expired_keys, "Quiet": True})
                    removed = len(expired_keys)
            except Exception as exc:
                logger.warning("s3_cache_purge_failed", extra={"error": str(exc)})
            return {"backend": "s3", "scanned": scanned, "removed": removed}

        for file_path in self.base_dir.rglob("*.png"):
            if scanned >= bounded_limit:
                break
            scanned += 1
            try:
                if self._is_expired(file_path.stat().st_mtime):
                    file_path.unlink(missing_ok=True)
                    removed += 1
            except FileNotFoundError:
                continue
        return {"backend": "local", "scanned": scanned, "removed": removed}

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
