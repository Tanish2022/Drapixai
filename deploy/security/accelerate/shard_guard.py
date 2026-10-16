"""Candidate guard for materialized, read-only local checkpoint directories.

Inserted into the pinned Accelerate loader only by build_candidate.py. This does
not authenticate weights or defend against a privileged concurrent host writer.
"""


def _drapixai_checkpoint_files(checkpoint_folder, index):
    import os
    from pathlib import Path, PurePosixPath, PureWindowsPath
    import stat

    def inspect(path):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("DRAPIXAI_CHECKPOINT_LINK_REJECTED")
        return info.st_mode

    root = Path(checkpoint_folder)
    if not stat.S_ISDIR(inspect(root)):
        raise ValueError("DRAPIXAI_CHECKPOINT_ROOT_INVALID")
    root = root.resolve(strict=True)
    if not isinstance(index, dict) or not index or len(index) > 100_000:
        raise ValueError("DRAPIXAI_CHECKPOINT_MAP_INVALID")
    for parameter, name in index.items():
        if not isinstance(parameter, str) or not parameter or not isinstance(name, str) or not name:
            raise ValueError("DRAPIXAI_CHECKPOINT_MAP_INVALID")
        posix = PurePosixPath(name)
        windows = PureWindowsPath(name)
        if ("\x00" in name or "\\" in name or posix.is_absolute()
                or windows.drive or windows.root or ".." in posix.parts):
            raise ValueError("DRAPIXAI_CHECKPOINT_ESCAPE")
        current = root
        for component in posix.parts:
            current = current / component
            inspect(current)
        if not stat.S_ISREG(inspect(current)):
            raise ValueError("DRAPIXAI_CHECKPOINT_NOT_REGULAR")
        if not current.resolve(strict=True).is_relative_to(root):
            raise ValueError("DRAPIXAI_CHECKPOINT_ESCAPE")
    # Preserve the upstream ordering and spelling of every valid shard path.
    return [os.path.join(checkpoint_folder, name) for name in sorted(set(index.values()))]
