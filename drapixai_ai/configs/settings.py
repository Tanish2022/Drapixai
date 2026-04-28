from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import timedelta


def _apply_gpu_preset() -> None:
    preset = os.getenv("DRAPIXAI_GPU_PRESET")
    if not preset:
        return
    key = preset.strip().lower()
    mapping = {
        "4060": {
            "DRAPIXAI_INPUT_MAX_SIDE": "448",
            "DRAPIXAI_ENHANCED_STEPS": "28",
            "DRAPIXAI_ENHANCED_GUIDANCE": "2.6",
            "DRAPIXAI_LOW_VRAM": "1",
            "DRAPIXAI_OPENPOSE_DEVICE": "cpu",
            "DRAPIXAI_PRELOAD_MODEL": "0",
        },
        "a10": {
            "DRAPIXAI_INPUT_MAX_SIDE": "512",
            "DRAPIXAI_ENHANCED_STEPS": "32",
            "DRAPIXAI_ENHANCED_GUIDANCE": "3.0",
            "DRAPIXAI_JOB_TIMEOUT": "1200",
            "DRAPIXAI_MAX_WAIT": "180",
            "DRAPIXAI_PRELOAD_MODEL": "1",
        },
        "a100": {
            "DRAPIXAI_INPUT_MAX_SIDE": "640",
            "DRAPIXAI_ENHANCED_STEPS": "36",
            "DRAPIXAI_ENHANCED_GUIDANCE": "3.0",
            "DRAPIXAI_JOB_TIMEOUT": "1800",
            "DRAPIXAI_MAX_WAIT": "300",
            "DRAPIXAI_LOW_VRAM": "0",
            "DRAPIXAI_OPENPOSE_DEVICE": "cuda",
            "DRAPIXAI_PRELOAD_MODEL": "1",
        },
        "runpod-a100": {
            "DRAPIXAI_INPUT_MAX_SIDE": "640",
            "DRAPIXAI_ENHANCED_STEPS": "36",
            "DRAPIXAI_ENHANCED_GUIDANCE": "3.0",
            "DRAPIXAI_JOB_TIMEOUT": "1800",
            "DRAPIXAI_MAX_WAIT": "300",
            "DRAPIXAI_LOW_VRAM": "0",
            "DRAPIXAI_OPENPOSE_DEVICE": "cuda",
            "DRAPIXAI_PRELOAD_MODEL": "1",
        },
        "t4": {
            "DRAPIXAI_INPUT_MAX_SIDE": "512",
            "DRAPIXAI_ENHANCED_STEPS": "28",
            "DRAPIXAI_ENHANCED_GUIDANCE": "2.6",
            "DRAPIXAI_PRELOAD_MODEL": "0",
        },
    }
    preset_values = mapping.get(key)
    if not preset_values:
        return
    for k, v in preset_values.items():
        os.environ.setdefault(k, v)


_apply_gpu_preset()


@dataclass(frozen=True)
class Settings:
    redis_url: str = os.getenv("DRAPIXAI_REDIS_URL", "redis://localhost:6379/0")
    queue_name: str = os.getenv("DRAPIXAI_QUEUE_NAME", "drapixai_tryon")
    model_dir: str = os.getenv("DRAPIXAI_MODEL_DIR", "models/idm_vton")
    device: str = os.getenv("DRAPIXAI_DEVICE", "cuda")
    cuda_device_index: int = int(os.getenv("DRAPIXAI_CUDA_DEVICE", "0"))

    job_timeout_seconds: int = int(os.getenv("DRAPIXAI_JOB_TIMEOUT", "900"))
    result_ttl_seconds: int = int(os.getenv("DRAPIXAI_RESULT_TTL", "900"))
    max_wait_seconds: int = int(os.getenv("DRAPIXAI_MAX_WAIT", "120"))
    poll_interval_seconds: float = float(os.getenv("DRAPIXAI_POLL_INTERVAL", "0.5"))

    monthly_basic_limit: int = int(os.getenv("DRAPIXAI_BASIC_LIMIT", "1200"))

    request_max_bytes: int = int(os.getenv("DRAPIXAI_REQUEST_MAX_BYTES", "10485760"))
    output_format: str = os.getenv("DRAPIXAI_OUTPUT_FORMAT", "png")
    inference_steps: int = int(os.getenv("DRAPIXAI_INFERENCE_STEPS", "28"))
    guidance_scale: float = float(os.getenv("DRAPIXAI_GUIDANCE_SCALE", "2.5"))
    enhanced_inference_steps: int = int(os.getenv("DRAPIXAI_ENHANCED_STEPS", "30"))
    enhanced_guidance_scale: float = float(os.getenv("DRAPIXAI_ENHANCED_GUIDANCE", "2.8"))
    input_max_side: int = int(os.getenv("DRAPIXAI_INPUT_MAX_SIDE", "512"))

    enable_xformers: bool = os.getenv("DRAPIXAI_ENABLE_XFORMERS", "1") == "1"
    enable_tf32: bool = os.getenv("DRAPIXAI_ENABLE_TF32", "1") == "1"
    enable_cpu_offload: bool = os.getenv("DRAPIXAI_ENABLE_CPU_OFFLOAD", "0") == "1"
    enable_vae_tiling: bool = os.getenv("DRAPIXAI_ENABLE_VAE_TILING", "1") == "1"
    low_vram_mode: bool = os.getenv("DRAPIXAI_LOW_VRAM", "0") == "1"
    preload_model_on_start: bool = os.getenv("DRAPIXAI_PRELOAD_MODEL", "0") == "1"

    log_level: str = os.getenv("DRAPIXAI_LOG_LEVEL", "INFO")
    enforce_upper_body: bool = os.getenv("DRAPIXAI_ENFORCE_UPPER_BODY", "1") == "1"
    upper_body_min_ratio: float = float(os.getenv("DRAPIXAI_UPPER_BODY_MIN_RATIO", "1.1"))
    upper_body_edge_ratio: float = float(os.getenv("DRAPIXAI_UPPER_BODY_EDGE_RATIO", "0.7"))
    garment_min_width: int = int(os.getenv("DRAPIXAI_GARMENT_MIN_WIDTH", "512"))
    garment_min_height: int = int(os.getenv("DRAPIXAI_GARMENT_MIN_HEIGHT", "512"))
    garment_alpha_threshold: int = int(os.getenv("DRAPIXAI_GARMENT_ALPHA_THRESHOLD", "16"))
    garment_transparent_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_TRANSPARENT_RATIO", "0.15"))
    garment_crop_padding_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_CROP_PADDING_RATIO", "0.12"))
    garment_target_width: int = int(os.getenv("DRAPIXAI_GARMENT_TARGET_WIDTH", "384"))
    garment_target_height: int = int(os.getenv("DRAPIXAI_GARMENT_TARGET_HEIGHT", "512"))
    garment_min_fg_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_MIN_FG_RATIO", "0.08"))
    garment_max_fg_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_MAX_FG_RATIO", "0.9"))
    garment_max_aspect_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_MAX_ASPECT_RATIO", "1.75"))
    garment_isolation_check: bool = os.getenv("DRAPIXAI_GARMENT_ISOLATION_CHECK", "1") == "1"
    garment_skin_ratio_threshold: float = float(os.getenv("DRAPIXAI_GARMENT_SKIN_RATIO_THRESHOLD", "0.04"))
    garment_top_skin_ratio_threshold: float = float(os.getenv("DRAPIXAI_GARMENT_TOP_SKIN_RATIO_THRESHOLD", "0.12"))
    garment_blur_check: bool = os.getenv("DRAPIXAI_GARMENT_BLUR_CHECK", "1") == "1"
    garment_blur_threshold: float = float(os.getenv("DRAPIXAI_GARMENT_BLUR_THRESHOLD", "80.0"))
    garment_cache_dir: str = os.getenv("DRAPIXAI_GARMENT_CACHE_DIR", "drapixai_ai/garments")
    garment_cache_ttl_seconds: int = int(os.getenv("DRAPIXAI_GARMENT_CACHE_TTL", "7776000"))  # 90 days
    admin_token: str = os.getenv("DRAPIXAI_ADMIN_TOKEN", "")
    garment_cache_backend: str = os.getenv("DRAPIXAI_GARMENT_CACHE_BACKEND", "local")
    s3_endpoint: str = os.getenv("DRAPIXAI_S3_ENDPOINT", "")
    s3_bucket: str = os.getenv("DRAPIXAI_S3_BUCKET", "drapixai")
    s3_region: str = os.getenv("DRAPIXAI_S3_REGION", "us-east-1")
    s3_access_key_id: str = os.getenv("DRAPIXAI_S3_ACCESS_KEY_ID", "")
    s3_secret_access_key: str = os.getenv("DRAPIXAI_S3_SECRET_ACCESS_KEY", "")

    def result_ttl(self) -> timedelta:
        return timedelta(seconds=self.result_ttl_seconds)

    def garment_target_size(self) -> tuple[int, int]:
        return (self.garment_target_width, self.garment_target_height)


settings = Settings()
