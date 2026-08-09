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
            "DRAPIXAI_INFERENCE_STEPS": "22",
            "DRAPIXAI_GUIDANCE_SCALE": "2.5",
            "DRAPIXAI_LOW_VRAM": "1",
            "DRAPIXAI_OPENPOSE_DEVICE": "cpu",
            "DRAPIXAI_PRELOAD_MODEL": "0",
        },
        "a10": {
            "DRAPIXAI_INPUT_MAX_SIDE": "512",
            "DRAPIXAI_INFERENCE_STEPS": "22",
            "DRAPIXAI_GUIDANCE_SCALE": "2.5",
            "DRAPIXAI_JOB_TIMEOUT": "1200",
            "DRAPIXAI_MAX_WAIT": "180",
            "DRAPIXAI_PRELOAD_MODEL": "1",
        },
        "a100": {
            "DRAPIXAI_INPUT_MAX_SIDE": "640",
            "DRAPIXAI_INFERENCE_STEPS": "22",
            "DRAPIXAI_GUIDANCE_SCALE": "2.5",
            "DRAPIXAI_JOB_TIMEOUT": "1800",
            "DRAPIXAI_MAX_WAIT": "300",
            "DRAPIXAI_LOW_VRAM": "0",
            "DRAPIXAI_OPENPOSE_DEVICE": "cuda",
            "DRAPIXAI_PRELOAD_MODEL": "1",
        },
        "runpod-a100": {
            "DRAPIXAI_INPUT_MAX_SIDE": "640",
            "DRAPIXAI_INFERENCE_STEPS": "22",
            "DRAPIXAI_GUIDANCE_SCALE": "2.5",
            "DRAPIXAI_JOB_TIMEOUT": "1800",
            "DRAPIXAI_MAX_WAIT": "300",
            "DRAPIXAI_LOW_VRAM": "0",
            "DRAPIXAI_OPENPOSE_DEVICE": "cuda",
            "DRAPIXAI_PRELOAD_MODEL": "1",
        },
        "rtx-pro-6000-blackwell": {
            "DRAPIXAI_INPUT_MAX_SIDE": "640",
            "DRAPIXAI_JOB_TIMEOUT": "1800",
            "DRAPIXAI_MAX_WAIT": "300",
            "DRAPIXAI_LOW_VRAM": "0",
            "DRAPIXAI_OPENPOSE_DEVICE": "cuda",
            "DRAPIXAI_PRELOAD_MODEL": "1",
            "DRAPIXAI_ADAPTIVE_BATCHING": "1",
            "DRAPIXAI_GPU_BATCH_MAX": "3",
            "DRAPIXAI_BATCH_WAIT_MS": "150",
        },
        "t4": {
            "DRAPIXAI_INPUT_MAX_SIDE": "512",
            "DRAPIXAI_INFERENCE_STEPS": "22",
            "DRAPIXAI_GUIDANCE_SCALE": "2.5",
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
    redis_password: str = os.getenv("DRAPIXAI_REDIS_PASSWORD", "")
    queue_name: str = os.getenv("DRAPIXAI_QUEUE_NAME", "drapixai_tryon")
    lower_body_queue_name: str = os.getenv(
        "DRAPIXAI_LOWER_BODY_QUEUE_NAME", "drapixai_lower_tryon"
    )
    worker_role: str = os.getenv("DRAPIXAI_WORKER_ROLE", "upper")
    model_dir: str = os.getenv("DRAPIXAI_MODEL_DIR", "models/catvton")
    tryon_engine: str = os.getenv("DRAPIXAI_TRYON_ENGINE", "catvton")
    catvton_model_dir: str = os.getenv("DRAPIXAI_CATVTON_MODEL_DIR", "models/catvton")
    catvton_repo_id: str = os.getenv("DRAPIXAI_CATVTON_REPO_ID", "zhengchong/CatVTON")
    catvton_model_revision: str = os.getenv(
        "DRAPIXAI_CATVTON_MODEL_REVISION",
        "2969fcf85fe62f2036605716f0b56f0b81d01d79",
    )
    catvton_base_model: str = os.getenv("DRAPIXAI_CATVTON_BASE_MODEL", "runwayml/stable-diffusion-inpainting")
    catvton_base_revision: str = os.getenv(
        "DRAPIXAI_CATVTON_BASE_REVISION",
        "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb",
    )
    catvton_vae_model: str = os.getenv("DRAPIXAI_CATVTON_VAE_MODEL", "stabilityai/sd-vae-ft-mse")
    catvton_vae_revision: str = os.getenv(
        "DRAPIXAI_CATVTON_VAE_REVISION",
        "31f26fdeee1355a5c34592e401dd41e45d25a493",
    )
    catvton_attn_version: str = os.getenv("DRAPIXAI_CATVTON_ATTN_VERSION", "mix")
    catvton_mixed_precision: str = os.getenv("DRAPIXAI_CATVTON_MIXED_PRECISION", "bf16")
    catvton_width: int = int(os.getenv("DRAPIXAI_CATVTON_WIDTH", "768"))
    catvton_height: int = int(os.getenv("DRAPIXAI_CATVTON_HEIGHT", "1024"))
    catvton_mask_blur: int = int(os.getenv("DRAPIXAI_CATVTON_MASK_BLUR", "9"))
    catvton_mask_source: str = os.getenv("DRAPIXAI_CATVTON_MASK_SOURCE", "automasker")
    catvton_skip_safety_check: bool = os.getenv("DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK", "0") == "1"
    catvton_preserve_untucked_hem: bool = os.getenv("DRAPIXAI_CATVTON_PRESERVE_UNTUCKED_HEM", "1") == "1"
    catvton_hem_extension_ratio: float = float(os.getenv("DRAPIXAI_CATVTON_HEM_EXTENSION_RATIO", "0.84"))
    catvton_upper_hem_max_ratio: float = float(os.getenv("DRAPIXAI_CATVTON_UPPER_HEM_MAX_RATIO", "0.78"))
    catvton_upper_hem_side_lift_ratio: float = float(os.getenv("DRAPIXAI_CATVTON_UPPER_HEM_SIDE_LIFT_RATIO", "0.032"))
    catvton_preserve_long_sleeves: bool = os.getenv("DRAPIXAI_CATVTON_PRESERVE_LONG_SLEEVES", "1") == "1"
    catvton_long_sleeve_wrist_ratio: float = float(os.getenv("DRAPIXAI_CATVTON_LONG_SLEEVE_WRIST_RATIO", "0.755"))
    catvton_folded_cuff_wrist_ratio: float = float(os.getenv("DRAPIXAI_CATVTON_FOLDED_CUFF_WRIST_RATIO", "0.715"))
    catvton_rolled_sleeve_wrist_ratio: float = float(os.getenv("DRAPIXAI_CATVTON_ROLLED_SLEEVE_WRIST_RATIO", "0.640"))
    enable_garment_color_fix: bool = os.getenv("DRAPIXAI_ENABLE_GARMENT_COLOR_FIX", "1") == "1"
    garment_color_fix_strength: float = float(os.getenv("DRAPIXAI_GARMENT_COLOR_FIX_STRENGTH", "0.94"))
    garment_color_fix_edge_guard: bool = os.getenv("DRAPIXAI_GARMENT_COLOR_FIX_EDGE_GUARD", "1") == "1"
    background_color_cast_threshold: float = float(os.getenv("DRAPIXAI_BACKGROUND_COLOR_CAST_THRESHOLD", "0.055"))
    enable_natural_lighting_fix: bool = os.getenv("DRAPIXAI_ENABLE_NATURAL_LIGHTING_FIX", "1") == "1"
    natural_lighting_strength: float = float(os.getenv("DRAPIXAI_NATURAL_LIGHTING_STRENGTH", "0.55"))
    enable_fashion_polish: bool = os.getenv("DRAPIXAI_ENABLE_FASHION_POLISH", "1") == "1"
    fashion_polish_strength: float = float(os.getenv("DRAPIXAI_FASHION_POLISH_STRENGTH", "0.45"))
    enable_person_context_restore: bool = os.getenv("DRAPIXAI_ENABLE_PERSON_CONTEXT_RESTORE", "0") == "1"
    person_context_restore_strength: float = float(os.getenv("DRAPIXAI_PERSON_CONTEXT_RESTORE_STRENGTH", "0.92"))
    enable_refinement: bool = os.getenv("DRAPIXAI_ENABLE_REFINEMENT", "0") == "1"
    enable_upscale: bool = os.getenv("DRAPIXAI_ENABLE_UPSCALE", "0") == "1"
    output_width: int = int(os.getenv("DRAPIXAI_OUTPUT_WIDTH", "1024"))
    output_height: int = int(os.getenv("DRAPIXAI_OUTPUT_HEIGHT", "1365"))
    enable_final_output_upscale: bool = os.getenv("DRAPIXAI_ENABLE_FINAL_OUTPUT_UPSCALE", "1") == "1"
    min_quality_score: float = float(os.getenv("DRAPIXAI_MIN_QUALITY_SCORE", "0.95"))
    device: str = os.getenv("DRAPIXAI_DEVICE", "cuda")
    cuda_device_index: int = int(os.getenv("DRAPIXAI_CUDA_DEVICE", "0"))

    job_timeout_seconds: int = int(os.getenv("DRAPIXAI_JOB_TIMEOUT", "900"))
    queue_ttl_seconds: int = int(os.getenv("DRAPIXAI_QUEUE_TTL", "180"))
    result_ttl_seconds: int = int(os.getenv("DRAPIXAI_RESULT_TTL", "60"))
    failure_ttl_seconds: int = int(os.getenv("DRAPIXAI_FAILURE_TTL", "60"))
    max_wait_seconds: int = int(os.getenv("DRAPIXAI_MAX_WAIT", "120"))
    poll_interval_seconds: float = float(os.getenv("DRAPIXAI_POLL_INTERVAL", "0.5"))
    target_tryon_ms: int = int(os.getenv("DRAPIXAI_TARGET_TRYON_MS", "12000"))
    adaptive_batching: bool = os.getenv("DRAPIXAI_ADAPTIVE_BATCHING", "0") == "1"
    # Three is the validated launch target. Batch four requires a separate
    # quality, latency, and VRAM approval before this cap may be raised.
    gpu_batch_max: int = min(3, max(1, int(os.getenv("DRAPIXAI_GPU_BATCH_MAX", "3"))))
    batch_wait_ms: int = max(0, min(500, int(os.getenv("DRAPIXAI_BATCH_WAIT_MS", "150"))))
    batch_oom_fallback: bool = os.getenv("DRAPIXAI_BATCH_OOM_FALLBACK", "1") == "1"
    batch_vram_headroom_ratio: float = float(
        os.getenv("DRAPIXAI_BATCH_VRAM_HEADROOM_RATIO", "0.20")
    )
    transient_spool_dir: str = os.getenv("DRAPIXAI_TRANSIENT_SPOOL_DIR", "runtime/tryon-spool")
    transient_spool_ttl_seconds: int = int(os.getenv("DRAPIXAI_TRANSIENT_SPOOL_TTL", "900"))

    monthly_basic_limit: int = int(os.getenv("DRAPIXAI_BASIC_LIMIT", "1200"))

    request_max_bytes: int = int(os.getenv("DRAPIXAI_REQUEST_MAX_BYTES", "10485760"))
    request_max_pixels: int = int(os.getenv("DRAPIXAI_REQUEST_MAX_PIXELS", "40000000"))
    output_format: str = os.getenv("DRAPIXAI_OUTPUT_FORMAT", "png")
    inference_steps: int = int(os.getenv("DRAPIXAI_INFERENCE_STEPS", "28"))
    guidance_scale: float = float(os.getenv("DRAPIXAI_GUIDANCE_SCALE", "2.5"))
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
    upper_body_reject_edge_ratio: bool = os.getenv("DRAPIXAI_UPPER_BODY_REJECT_EDGE_RATIO", "0") == "1"
    enable_lower_body: bool = os.getenv("DRAPIXAI_ENABLE_LOWER_BODY", "0") == "1"
    lower_body_engine: str = os.getenv("DRAPIXAI_LOWER_BODY_ENGINE", "catvton")
    fashn_weights_dir: str = os.getenv(
        "DRAPIXAI_FASHN_WEIGHTS_DIR", "models/fashn-vton-1.5"
    )
    fashn_num_timesteps: int = int(os.getenv("DRAPIXAI_FASHN_NUM_TIMESTEPS", "50"))
    fashn_guidance_scale: float = float(
        os.getenv("DRAPIXAI_FASHN_GUIDANCE_SCALE", "1.5")
    )
    fashn_garment_photo_type: str = os.getenv(
        "DRAPIXAI_FASHN_GARMENT_PHOTO_TYPE", "flat-lay"
    )
    fashn_segmentation_free: bool = (
        os.getenv("DRAPIXAI_FASHN_SEGMENTATION_FREE", "1") == "1"
    )
    fashn_enable_postprocess: bool = (
        os.getenv("DRAPIXAI_FASHN_ENABLE_POSTPROCESS", "0") == "1"
    )
    lower_body_allowed_categories: str = os.getenv(
        "DRAPIXAI_LOWER_BODY_ALLOWED_CATEGORIES",
        "jeans,pants,trousers,shorts,skirt,leggings,joggers",
    )
    lower_body_admin_review_required: bool = os.getenv("DRAPIXAI_LOWER_BODY_ADMIN_REVIEW_REQUIRED", "1") == "1"
    lower_body_preserve_shoes: bool = os.getenv("DRAPIXAI_LOWER_BODY_PRESERVE_SHOES", "1") == "1"
    lower_body_mask_blur: int = int(os.getenv("DRAPIXAI_LOWER_BODY_MASK_BLUR", "9"))
    lower_body_mask_waist_ratio: float = float(os.getenv("DRAPIXAI_LOWER_BODY_MASK_WAIST_RATIO", "0.46"))
    lower_body_mask_ankle_ratio: float = float(os.getenv("DRAPIXAI_LOWER_BODY_MASK_ANKLE_RATIO", "0.90"))
    lower_body_restore_context: bool = os.getenv("DRAPIXAI_LOWER_BODY_RESTORE_CONTEXT", "1") == "1"
    lower_body_postprocess_feather: int = int(os.getenv("DRAPIXAI_LOWER_BODY_POSTPROCESS_FEATHER", "5"))
    lower_body_postprocess_mask_inset: int = int(os.getenv("DRAPIXAI_LOWER_BODY_POSTPROCESS_MASK_INSET", "2"))
    lower_body_color_fix_strength: float = float(os.getenv("DRAPIXAI_LOWER_BODY_COLOR_FIX_STRENGTH", "0.78"))
    lower_body_cache_version: str = os.getenv("DRAPIXAI_LOWER_BODY_CACHE_VERSION", "lower-v1-1024x1365")
    garment_min_width: int = int(os.getenv("DRAPIXAI_GARMENT_MIN_WIDTH", "512"))
    garment_min_height: int = int(os.getenv("DRAPIXAI_GARMENT_MIN_HEIGHT", "512"))
    garment_alpha_threshold: int = int(os.getenv("DRAPIXAI_GARMENT_ALPHA_THRESHOLD", "16"))
    garment_transparent_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_TRANSPARENT_RATIO", "0.15"))
    garment_crop_padding_ratio: float = float(os.getenv("DRAPIXAI_GARMENT_CROP_PADDING_RATIO", "0.12"))
    garment_target_width: int = int(os.getenv("DRAPIXAI_GARMENT_TARGET_WIDTH", "1024"))
    garment_target_height: int = int(os.getenv("DRAPIXAI_GARMENT_TARGET_HEIGHT", "1365"))
    garment_condition_max_edge: int = int(os.getenv("DRAPIXAI_GARMENT_CONDITION_MAX_EDGE", "1536"))
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
    garment_cache_purge_interval_seconds: int = int(os.getenv("DRAPIXAI_GARMENT_CACHE_PURGE_INTERVAL_SECONDS", "21600"))
    garment_cache_purge_limit: int = int(os.getenv("DRAPIXAI_GARMENT_CACHE_PURGE_LIMIT", "1000"))
    garment_cache_version: str = os.getenv("DRAPIXAI_GARMENT_CACHE_VERSION", "v3-1024x1365")
    admin_token: str = os.getenv("DRAPIXAI_ADMIN_TOKEN", "")
    ai_service_token: str = os.getenv("DRAPIXAI_AI_SERVICE_TOKEN", "")
    garment_cache_backend: str = os.getenv("DRAPIXAI_GARMENT_CACHE_BACKEND", "local")
    garment_fast_plain_background_matte: bool = os.getenv("DRAPIXAI_GARMENT_FAST_PLAIN_BACKGROUND_MATTE", "0") == "1"
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
