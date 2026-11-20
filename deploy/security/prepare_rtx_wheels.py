"""Prepare the two reviewed wheels for the isolated RTX Docker build."""
import argparse
import hashlib
import importlib.util
import shutil
import tempfile
import urllib.request
from pathlib import Path


def prepare(destination, upstream=None):
    security = Path(__file__).resolve().parent
    allowed = (security.parents[1] / "runtime/security-candidate").resolve()
    destination = destination.resolve()
    if destination == allowed or not destination.is_relative_to(allowed):
        raise ValueError("Wheel context must be inside runtime/security-candidate")
    destination.mkdir(parents=True, exist_ok=True)
    context = destination / "wheel-context"
    if context.is_symlink():
        raise ValueError("Wheel context must be a local directory")
    context.mkdir(exist_ok=True)
    if any(not entry.is_file() or entry.is_symlink() for entry in context.iterdir()):
        raise ValueError("Unexpected entry in wheel context")
    expected = set()
    for name in ("accelerate", "rembg"):
        spec = importlib.util.spec_from_file_location(name + "_builder", security / name / "build_candidate.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        filename = f"{name}-{builder.VERSION}-py3-none-any.whl"
        if upstream:
            source = upstream / filename
        else:
            source = destination / filename
            if not source.exists():
                with tempfile.NamedTemporaryFile(dir=destination, delete=False) as temporary:
                    pending = Path(temporary.name)
                try:
                    with urllib.request.urlopen(builder.SOURCE_URL, timeout=45) as response, pending.open("wb") as stream:
                        shutil.copyfileobj(response, stream)
                    if hashlib.sha256(pending.read_bytes()).hexdigest() != builder.WHEEL_SHA256:
                        raise ValueError("Unexpected upstream wheel checksum")
                    pending.replace(source)
                finally:
                    pending.unlink(missing_ok=True)
        # Both builders check the whole upstream wheel hash before processing it.
        output = destination / name
        builder.build(source, output)
        wheel = f"{name}-{builder.VERSION}-{builder.BUILD}-py3-none-any.whl"
        shutil.copyfile(output / wheel, context / wheel)
        expected.add(wheel)
    if {entry.name for entry in context.iterdir()} != expected:
        raise ValueError("Unexpected files in named wheel context")
    return context


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--upstream-dir", type=Path, help="Read both official wheels from this directory offline")
    args = parser.parse_args()
    print(prepare(args.output_dir, args.upstream_dir))
