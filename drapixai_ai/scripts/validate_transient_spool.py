from __future__ import annotations

import ast
import asyncio
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import Mock, patch

from drapixai_ai.configs.settings import settings
from drapixai_ai.services.transient_spool import (
    cleanup_expired_transients,
    delete_transient,
    read_transient_bytes,
    write_transient_bytes,
    run_transient_cleanup_loop,
)
from drapixai_ai.services import transient_spool


async def verify_idle_cleanup() -> None:
    original_dir, original_ttl = settings.transient_spool_dir, settings.transient_spool_ttl_seconds
    with tempfile.TemporaryDirectory(prefix="drapixai-idle-spool-test-") as directory:
        object.__setattr__(settings, "transient_spool_dir", directory)
        object.__setattr__(settings, "transient_spool_ttl_seconds", 1)
        calls = 0
        real_cleanup = cleanup_expired_transients
        logger = Mock()
        original_to_thread = asyncio.to_thread
        in_flight = []

        async def tracked_to_thread(function, *args, **kwargs):
            thread_task = asyncio.create_task(original_to_thread(function, *args, **kwargs))
            in_flight.append(thread_task)
            return await asyncio.shield(thread_task)

        def failing_once() -> int:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise OSError("private-shopper-path-must-not-be-logged")
            return real_cleanup()

        async def wait_until(predicate) -> None:
            deadline = asyncio.get_running_loop().time() + 3
            while not predicate():
                assert asyncio.get_running_loop().time() < deadline, "IDLE_CLEANUP_NOT_OBSERVED"
                await asyncio.sleep(0.01)

        task = None
        try:
            with patch.object(transient_spool, "cleanup_expired_transients", failing_once), patch.object(transient_spool, "_LOGGER", logger), patch.object(asyncio, "to_thread", tracked_to_thread):
                task = asyncio.create_task(run_transient_cleanup_loop(0.02))
                await wait_until(lambda: calls >= 2)
                # Create an orphan after startup has already completed. No
                # request, queue, model or job triggers its eventual removal.
                expired = write_transient_bytes(b"synthetic orphan")
                expired_path = Path(directory) / f"{expired.removeprefix('spool:')}.bin"
                os.utime(expired_path, (time.time() - 5, time.time() - 5))
                fresh = write_transient_bytes(b"preserve unexpired synthetic bytes")
                fresh_path = Path(directory) / f"{fresh.removeprefix('spool:')}.bin"
                os.utime(fresh_path, (time.time() + 60, time.time() + 60))
                await wait_until(lambda: not expired_path.exists())
                assert read_transient_bytes(fresh) == b"preserve unexpired synthetic bytes"
                logger.error.assert_called_once_with("transient_spool_cleanup_failed", extra={"error_type": "OSError"})
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
                assert task.cancelled()
                await asyncio.gather(*in_flight, return_exceptions=True)

            # Execute the real startup/shutdown handler bodies without importing
            # the model-loading API module. This is lifecycle glue coverage,
            # not a FastAPI/GPU deployment or whole-app startup test.
            api = Path(__file__).resolve().parents[1] / "api" / "ai_server.py"
            tree = ast.parse(api.read_text(encoding="utf-8"))
            names = {"start_transient_spool_cleanup", "stop_transient_spool_cleanup"}
            handlers = [node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name in names]
            assert len(handlers) == 2
            class FixtureApp:
                def on_event(self, event):
                    assert event in {"startup", "shutdown"}
                    return lambda function: function
            async def lifecycle_loop():
                await asyncio.sleep(60)
            scope = {"app": FixtureApp(), "asyncio": asyncio, "spool_cleanup_task": None, "run_transient_cleanup_loop": lifecycle_loop}
            exec(compile(ast.Module(body=handlers, type_ignores=[]), str(api), "exec"), scope)
            await scope["start_transient_spool_cleanup"]()
            lifecycle_task = scope["spool_cleanup_task"]
            assert isinstance(lifecycle_task, asyncio.Task)
            await asyncio.sleep(0)
            await scope["stop_transient_spool_cleanup"]()
            assert scope["spool_cleanup_task"] is None and lifecycle_task.cancelled()
        finally:
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            # Cancellation cannot stop a running filesystem thread. Drain only
            # our tracked work before restoring the real configured directory.
            await asyncio.gather(*in_flight, return_exceptions=True)
            object.__setattr__(settings, "transient_spool_dir", original_dir)
            object.__setattr__(settings, "transient_spool_ttl_seconds", original_ttl)


def main() -> None:
    original_dir = settings.transient_spool_dir
    original_ttl = settings.transient_spool_ttl_seconds
    with tempfile.TemporaryDirectory(prefix="drapixai-spool-test-") as temporary_dir:
        object.__setattr__(settings, "transient_spool_dir", temporary_dir)
        object.__setattr__(settings, "transient_spool_ttl_seconds", 1)
        try:
            reference = write_transient_bytes(b"private-image-bytes")
            assert reference.startswith("spool:")
            assert read_transient_bytes(reference) == b"private-image-bytes"
            assert delete_transient(reference) is True
            assert delete_transient(reference) is False

            try:
                read_transient_bytes("spool:../../outside")
                raise AssertionError("Invalid transient reference was accepted")
            except ValueError:
                pass

            expired_reference = write_transient_bytes(b"expired")
            token = expired_reference.removeprefix("spool:")
            expired_path = os.path.join(temporary_dir, f"{token}.bin")
            old_time = time.time() - 5
            os.utime(expired_path, (old_time, old_time))
            assert cleanup_expired_transients() == 1
            assert not os.path.exists(expired_path)
        finally:
            object.__setattr__(settings, "transient_spool_dir", original_dir)
            object.__setattr__(settings, "transient_spool_ttl_seconds", original_ttl)

    asyncio.run(verify_idle_cleanup())
    print("Transient spool validation passed: CRUD, path rejection, expiry, idle cleanup, failure retry and lifecycle glue.")


if __name__ == "__main__":
    main()
