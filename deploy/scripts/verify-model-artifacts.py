#!/usr/bin/env python3
"""Reject unsafe local checkpoint layouts without loading or modifying weights.

Run against provisioned, read-only model directories before starting AI services.
This is a deployment check, not dependency remediation or content provenance.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path, PurePosixPath, PureWindowsPath
import stat

MAX_INDEX_BYTES = 16 * 1024 * 1024
MAX_ENTRIES = 100_000


def _kind(path: Path) -> int:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("MODEL_ARTIFACT_LINK_REJECTED")
    if not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
        raise ValueError("MODEL_ARTIFACT_NON_REGULAR")
    return info.st_mode


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("MODEL_INDEX_DUPLICATE_KEY")
        result[key] = value
    return result


def verify(root: Path) -> dict[str, int]:
    # Deployment uses materialized local_dir snapshots, not hub-cache symlinks.
    # Reject links rather than silently following a shard outside the mount.
    if not stat.S_ISDIR(_kind(root)):
        raise ValueError("MODEL_ROOT_NOT_DIRECTORY")
    root = root.resolve(strict=True)
    pending = [root]
    indexes = []
    files = 0
    entries = 0
    while pending:
        directory = pending.pop()
        for entry in directory.iterdir():
            entries += 1
            if entries > MAX_ENTRIES:
                raise ValueError("MODEL_TREE_TOO_LARGE")
            mode = _kind(entry)
            if stat.S_ISDIR(mode):
                pending.append(entry)
            else:
                files += 1
                if entry.name.endswith(".index.json"):
                    indexes.append(entry)
    if not files:
        raise ValueError("MODEL_ROOT_EMPTY")

    shards = 0
    for index in indexes:
        if index.stat().st_size > MAX_INDEX_BYTES:
            raise ValueError("MODEL_INDEX_TOO_LARGE")
        document = json.loads(index.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)
        mapping = document.get("weight_map") if isinstance(document, dict) else None
        if not isinstance(mapping, dict) or not mapping:
            raise ValueError("MODEL_INDEX_WEIGHT_MAP_INVALID")
        for parameter, name in mapping.items():
            if not isinstance(parameter, str) or not parameter or not isinstance(name, str) or not name:
                raise ValueError("MODEL_INDEX_SHARD_INVALID")
            posix = PurePosixPath(name)
            windows = PureWindowsPath(name)
            if ("\x00" in name or "\\" in name or posix.is_absolute()
                    or windows.drive or windows.root or ".." in posix.parts):
                raise ValueError("MODEL_INDEX_SHARD_ESCAPE")
            target = index.parent.joinpath(*posix.parts)
            # Inspect each component without opening the shard. In particular,
            # never open a FIFO while attempting to validate it.
            current = index.parent
            for component in posix.parts:
                current = current / component
                _kind(current)
            if not stat.S_ISREG(_kind(target)):
                raise ValueError("MODEL_INDEX_SHARD_NOT_FILE")
            if not target.resolve(strict=True).is_relative_to(index.parent.resolve()):
                raise ValueError("MODEL_INDEX_SHARD_ESCAPE")
            shards += 1
    return {"files": files, "indexes": len(indexes), "shardReferences": shards}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", nargs="+", type=Path)
    args = parser.parse_args()
    try:
        results = [verify(root) for root in args.roots]
    except (OSError, ValueError) as error:
        # Do not emit model content, index values or host paths into logs.
        code = str(error) if isinstance(error, ValueError) and str(error).startswith("MODEL_") else type(error).__name__
        print(json.dumps({"status": "FAIL", "reason": code}))
        return 1
    print(json.dumps({"status": "PASS", "scope": "local-checkpoint-layout-only", "roots": results}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
