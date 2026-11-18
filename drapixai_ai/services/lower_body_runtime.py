from __future__ import annotations

import importlib.metadata
import json
import sys


EXPECTED_PACKAGES = {
    "torch": "2.11.0", "torchvision": "0.26.0",
    "fashn-vton": "1.5.0", "fashn-human-parser": "0.1.1",
    "onnxruntime-gpu": "1.20.1", "opencv-python": "4.10.0.84",
}
EXPECTED_SOURCE_ARCHIVES = {
    "fashn-vton": "b5b490bdec6d404d8db397f7bb7639d5d4d78f68677e90f9e3bc495d892032f8",
    "fashn-human-parser": "3d84a1959148d29f169ed78aa46b9ae8562e7df3f22465cc8f599adc8fdc04b8",
}


def collect_runtime_facts() -> dict[str, object]:
    import onnxruntime as ort
    import torch
    packages = {}
    origins = {}
    for name in EXPECTED_PACKAGES:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    for name in EXPECTED_SOURCE_ARCHIVES:
        try:
            document = importlib.metadata.distribution(name).read_text("direct_url.json")
            origins[name] = ((json.loads(document or "{}").get("archive_info") or {}).get("hashes") or {}).get("sha256")
        except (ValueError, importlib.metadata.PackageNotFoundError):
            origins[name] = None
    cuda = torch.cuda.is_available()
    capability = torch.cuda.get_device_capability(0) if cuda else None
    return {
        "python": list(sys.version_info[:2]),
        "packages": packages,
        "installed_packages": dict(sorted(
            (str(item.metadata.get("Name") or "").lower().replace("_", "-"), item.version)
            for item in importlib.metadata.distributions()
        )),
        "source_archives": origins,
        "cuda_available": cuda,
        "cuda_runtime": torch.version.cuda,
        "gpu": torch.cuda.get_device_name(0) if cuda else None,
        "total_vram_bytes": torch.cuda.get_device_properties(0).total_memory if cuda else None,
        "gpu_arch": f"sm_{capability[0]}{capability[1]}" if capability else None,
        "torch_arches": torch.cuda.get_arch_list() if cuda else [],
        "bf16_supported": cuda and torch.cuda.is_bf16_supported(),
        "onnxruntime_providers": ort.get_available_providers(),
    }


def validate_runtime_facts(facts: dict[str, object], required_gpu: str) -> list[str]:
    errors = []
    if facts.get("python") != [3, 12]:
        errors.append("PYTHON_VERSION_MISMATCH")
    for name, expected in EXPECTED_PACKAGES.items():
        if str((facts.get("packages") or {}).get(name) or "").split("+", 1)[0] != expected:
            errors.append(f"PACKAGE_VERSION_MISMATCH:{name}")
    for name in EXPECTED_SOURCE_ARCHIVES:
        if (facts.get("source_archives") or {}).get(name) != EXPECTED_SOURCE_ARCHIVES[name]:
            errors.append(f"PACKAGE_SOURCE_UNVERIFIED:{name}")
    if facts.get("cuda_available") is not True:
        errors.append("CUDA_UNAVAILABLE")
    if str(facts.get("cuda_runtime") or "").split(".")[:2] != ["12", "8"]:
        errors.append("CUDA_VERSION_MISMATCH")
    if not required_gpu.strip() or required_gpu.lower() not in str(facts.get("gpu") or "").lower():
        errors.append("UNEXPECTED_GPU")
    if facts.get("bf16_supported") is not True:
        errors.append("BF16_UNSUPPORTED")
    vram = facts.get("total_vram_bytes")
    if type(vram) is not int or vram < 75 * 1024 ** 3:
        errors.append("GPU_VRAM_BELOW_A100_80GB_CANDIDATE")
    if facts.get("gpu_arch") not in (facts.get("torch_arches") or []):
        errors.append("TORCH_GPU_ARCH_UNSUPPORTED")
    if "CUDAExecutionProvider" not in (facts.get("onnxruntime_providers") or []):
        errors.append("ORT_CUDA_PROVIDER_UNAVAILABLE")
    return errors
