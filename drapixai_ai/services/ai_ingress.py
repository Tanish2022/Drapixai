from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Optional


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


def normalize_request_id(value: Optional[str], fallback: Callable[[], str]) -> str:
    if value and REQUEST_ID_PATTERN.fullmatch(value):
        return value
    return fallback()


async def read_limited_chunks(
    reader: Callable[[int], Awaitable[bytes]],
    max_bytes: int,
    chunk_bytes: int,
) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while chunk := await reader(chunk_bytes):
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("UPLOAD_TOO_LARGE")
        chunks.append(chunk)
    return b"".join(chunks)
