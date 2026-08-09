from __future__ import annotations

import asyncio

from drapixai_ai.services.ai_ingress import normalize_request_id, read_limited_chunks


async def _assert_oversized_upload_rejected() -> None:
    chunks = [b"a" * 4, b"b" * 4]

    async def reader(_chunk_bytes: int) -> bytes:
        return chunks.pop(0) if chunks else b""

    try:
        await read_limited_chunks(reader, max_bytes=7, chunk_bytes=4)
    except ValueError as exc:
        if str(exc) != "UPLOAD_TOO_LARGE":
            raise AssertionError(f"Unexpected oversized-upload error: {exc}") from exc
    else:
        raise AssertionError("Oversized upload was accepted")


async def main() -> None:
    await _assert_oversized_upload_rejected()
    if normalize_request_id("release-check_01", lambda: "fallback") != "release-check_01":
        raise AssertionError("Valid request ID was unexpectedly replaced")
    if normalize_request_id("invalid request id", lambda: "fallback") != "fallback":
        raise AssertionError("Unsafe request ID was accepted")
    print("AI ingress security validation passed.")


if __name__ == "__main__":
    asyncio.run(main())
