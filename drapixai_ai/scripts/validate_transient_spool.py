from __future__ import annotations

import os
import tempfile
import time

from drapixai_ai.configs.settings import settings
from drapixai_ai.services.transient_spool import (
    cleanup_expired_transients,
    delete_transient,
    read_transient_bytes,
    write_transient_bytes,
)


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

    print("Transient spool validation passed.")


if __name__ == "__main__":
    main()
