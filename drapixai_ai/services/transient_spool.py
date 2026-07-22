from __future__ import annotations

import os
import secrets
import time
from pathlib import Path

from drapixai_ai.configs.settings import settings


_REFERENCE_PREFIX = "spool:"


def _spool_root() -> Path:
    root = Path(settings.transient_spool_dir).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        root.chmod(0o700)
    except OSError:
        pass
    return root


def _path_for(reference: str) -> Path:
    if not reference.startswith(_REFERENCE_PREFIX):
        raise ValueError("INVALID_TRANSIENT_REFERENCE")
    token = reference[len(_REFERENCE_PREFIX) :]
    if len(token) != 48 or any(character not in "0123456789abcdef" for character in token):
        raise ValueError("INVALID_TRANSIENT_REFERENCE")
    root = _spool_root()
    path = (root / f"{token}.bin").resolve()
    if path.parent != root:
        raise ValueError("INVALID_TRANSIENT_REFERENCE")
    return path


def write_transient_bytes(data: bytes) -> str:
    if not data:
        raise ValueError("EMPTY_TRANSIENT_PAYLOAD")
    reference = f"{_REFERENCE_PREFIX}{secrets.token_hex(24)}"
    path = _path_for(reference)
    with path.open("xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return reference


def read_transient_bytes(reference: str) -> bytes:
    path = _path_for(reference)
    data = path.read_bytes()
    if not data:
        raise ValueError("EMPTY_TRANSIENT_PAYLOAD")
    return data


def delete_transient(reference: str | None) -> bool:
    if not reference:
        return False
    try:
        path = _path_for(reference)
    except ValueError:
        return False
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def cleanup_expired_transients(max_age_seconds: int | None = None) -> int:
    max_age = max(1, max_age_seconds or settings.transient_spool_ttl_seconds)
    cutoff = time.time() - max_age
    removed = 0
    for path in _spool_root().glob("*.bin"):
        try:
            if path.is_file() and path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except FileNotFoundError:
            continue
    return removed
