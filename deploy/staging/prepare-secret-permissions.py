#!/usr/bin/env python3
"""Install metadata for the known staging API files without reading their values."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import sys

FILES = ("drapixai-api.json", "drapixai-internal-ca.pem", "drapixai-ai-client.crt", "drapixai-ai-client.key")
SERVICE_UID = SERVICE_GID = 65532


def prepare(directory: Path, check_only: bool = False) -> dict:
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("LINUX_ROOT_REQUIRED")
    descriptors: list[tuple[str, int]] = []
    directory_fd = None
    try:
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        directory_stat = os.fstat(directory_fd)
        if directory_stat.st_mode & 0o022:
            raise ValueError("PRIVATE_DIRECTORY_MUST_NOT_BE_GROUP_OR_WORLD_WRITABLE")
        # Open and validate every target before changing any metadata. All later
        # operations use these descriptors, not a newly resolved pathname.
        for name in FILES:
            try:
                descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory_fd)
            except OSError:
                raise ValueError(f"UNSAFE_OR_MISSING_SECRET_FILE:{name}") from None
            descriptors.append((name, descriptor))
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_dev != directory_stat.st_dev:
                raise ValueError(f"SECRET_MUST_BE_SINGLE_LINK_REGULAR_FILE:{name}")
            if metadata.st_uid not in (0, directory_stat.st_uid, SERVICE_UID):
                raise ValueError(f"UNEXPECTED_SECRET_OWNER:{name}")
        if check_only:
            if (directory_stat.st_uid, directory_stat.st_gid, stat.S_IMODE(directory_stat.st_mode)) != (0, 0, 0o700):
                raise ValueError("PRIVATE_DIRECTORY_METADATA_NOT_READY")
            for name, descriptor in descriptors:
                metadata = os.fstat(descriptor)
                if (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (SERVICE_UID, SERVICE_GID, 0o400):
                    raise ValueError(f"SECRET_METADATA_NOT_READY:{name}")
        else:
            # Keep the original directory owner until all file changes succeed,
            # so a failed metadata operation can be safely retried. Afterward,
            # root controls entries; sudo is needed for credential edits.
            os.fchmod(directory_fd, 0o700)
            for name, descriptor in descriptors:
                original = os.fstat(descriptor)
                current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if (original.st_dev, original.st_ino) != (current.st_dev, current.st_ino) or original.st_nlink != 1:
                    raise ValueError(f"SECRET_CHANGED_DURING_INSTALL:{name}")
            for _, descriptor in descriptors:
                os.fchmod(descriptor, 0o400)
                os.fchown(descriptor, SERVICE_UID, SERVICE_GID)
            os.fchown(directory_fd, 0, 0)
            for name, descriptor in descriptors:
                metadata = os.fstat(descriptor)
                current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if ((metadata.st_dev, metadata.st_ino) != (current.st_dev, current.st_ino)
                        or metadata.st_nlink != 1
                        or (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (SERVICE_UID, SERVICE_GID, 0o400)):
                    raise ValueError(f"SECRET_CHANGED_DURING_INSTALL:{name}")
        return {"passed": True, "checkOnly": check_only, "serviceUid": SERVICE_UID,
                "files": list(FILES), "fileMode": "0400", "directoryMode": "0700"}
    finally:
        for _, descriptor in descriptors:
            os.close(descriptor)
        if directory_fd is not None:
            os.close(directory_fd)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-dir", type=Path, default=Path(__file__).parent / "private")
    parser.add_argument("--check", action="store_true", help="Check metadata without changing it")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.private_dir, args.check)))
        return 0
    except (OSError, ValueError) as error:
        # Paths/values from secrets are never included in diagnostic output.
        detail = str(error) if isinstance(error, ValueError) else "PRIVATE_SECRET_METADATA_OPERATION_FAILED"
        print(f"Staging secret permissions failed: {detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
