from __future__ import annotations

import asyncio
import base64
import hmac
import io
import json
import os
import time
import uuid
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request, Header
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from PIL import Image
from rq import Worker

from drapixai_ai.configs.settings import settings
from drapixai_ai.queue.redis_queue import get_redis
from drapixai_ai.services.garment_cache import GarmentCache
from drapixai_ai.services.garment_preprocessor import (
    GarmentPreprocessOptions,
    GarmentValidationError,
    preprocess_garment,
)
from drapixai_ai.services.garment_rules import resolve_garment_rule
from drapixai_ai.services.ai_ingress import normalize_request_id, read_limited_chunks
from drapixai_ai.services.logger import get_logger
from drapixai_ai.services.lower_body_validator import validate_lower_body_person
from drapixai_ai.services.tryon_service import TryOnService
from drapixai_ai.services.upper_body_validator import is_upper_body

app = FastAPI(title="DrapixAI", version="1.0.0")
service = TryOnService()
garment_cache = GarmentCache()
logger = get_logger("drapixai_ai.api")
cache_purge_task: asyncio.Task | None = None

_UPLOAD_READ_CHUNK_BYTES = 1024 * 1024


async def _purge_expired_garment_cache_loop() -> None:
    interval_seconds = max(300, settings.garment_cache_purge_interval_seconds)
    while True:
        try:
            result = await asyncio.to_thread(garment_cache.purge_expired, settings.garment_cache_purge_limit)
            logger.info("garment_cache_purge_complete", extra=result)
        except Exception as exc:
            logger.error("garment_cache_purge_failed", extra={"error": str(exc)})
        await asyncio.sleep(interval_seconds)


@app.on_event("startup")
async def start_garment_cache_purge() -> None:
    global cache_purge_task
    cache_purge_task = asyncio.create_task(_purge_expired_garment_cache_loop())


@app.on_event("shutdown")
async def stop_garment_cache_purge() -> None:
    global cache_purge_task
    if cache_purge_task:
        cache_purge_task.cancel()
        try:
            await cache_purge_task
        except asyncio.CancelledError:
            pass
        cache_purge_task = None


@app.exception_handler(RequestValidationError)
async def sanitized_validation_error(_request: Request, exc: RequestValidationError):
    errors = []
    for error in exc.errors():
        errors.append(
            {
                "type": error.get("type"),
                "loc": error.get("loc"),
                "msg": error.get("msg"),
            }
        )
    return JSONResponse(status_code=422, content={"detail": errors})


class TryOnBase64Request(BaseModel):
    user_id: str = Field(..., min_length=1)
    person_image_base64: str = Field(..., min_length=1, max_length=settings.request_max_bytes * 2)
    cloth_image_base64: Optional[str] = Field(default=None, max_length=settings.request_max_bytes * 2)
    quality: Optional[str] = Field(default=None)
    garment_type: Optional[str] = Field(default=None)
    garment_category: Optional[str] = Field(default=None)
    cloth_cache_key: Optional[str] = Field(default=None)


class GarmentBase64Request(BaseModel):
    cloth_image_base64: str = Field(..., min_length=1, max_length=settings.request_max_bytes * 2)
    brand_id: Optional[str] = Field(default=None)
    garment_id: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)
    product_name: Optional[str] = Field(default=None)
    garment_profile: Optional[str] = Field(default=None)
    garment_type: Optional[str] = Field(default=None)
    admin_bypass: Optional[bool] = Field(default=False)


class GarmentCacheDeleteRequest(BaseModel):
    cache_key: str = Field(..., min_length=1, max_length=512)


def _decode_base64_image(value: Optional[str], field_name: str) -> bytes:
    if not value:
        raise HTTPException(status_code=400, detail=f"{field_name.upper()}_REQUIRED")

    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail=f"INVALID_{field_name.upper()}")
    if len(decoded) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
    return decoded


async def _read_upload_limited(upload: UploadFile, field_name: str) -> bytes:
    try:
        return await read_limited_chunks(
            upload.read,
            max_bytes=settings.request_max_bytes,
            chunk_bytes=_UPLOAD_READ_CHUNK_BYTES,
        )
    except ValueError as exc:
        if str(exc) == "UPLOAD_TOO_LARGE":
            raise HTTPException(status_code=413, detail=f"{field_name.upper()}_TOO_LARGE") from exc
        raise
    finally:
        await upload.close()


def _request_id(value: Optional[str]) -> str:
    return normalize_request_id(value, lambda: str(uuid.uuid4()))


def _is_production() -> bool:
    return (os.getenv("DRAPIXAI_ENV") or os.getenv("NODE_ENV") or "").strip().lower() == "production"


def _ready_payload(model_ready: bool, worker_ready: bool, include_details: bool) -> dict:
    payload = {"status": "ready" if model_ready and worker_ready else "not_ready"}
    if not include_details:
        return payload
    return {
        **payload,
        "model_ready": model_ready,
        "worker_ready": worker_ready,
        "engine": settings.tryon_engine,
        "lower_body_engine": settings.lower_body_engine if settings.enable_lower_body else "disabled",
        "adaptive_batching": settings.adaptive_batching,
        "gpu_batch_max": settings.gpu_batch_max if settings.adaptive_batching else 1,
    }


def _require_production_config() -> None:
    env = (os.getenv("DRAPIXAI_ENV") or os.getenv("NODE_ENV") or "").strip().lower()
    if env != "production":
        return

    missing = []
    if not settings.ai_service_token:
        missing.append("DRAPIXAI_AI_SERVICE_TOKEN")
    if not settings.admin_token:
        missing.append("DRAPIXAI_ADMIN_TOKEN")
    if not settings.redis_password:
        missing.append("DRAPIXAI_REDIS_PASSWORD")
    if settings.catvton_skip_safety_check:
        raise RuntimeError("PRODUCTION_CONFIG_INVALID DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK must equal 0")
    if missing:
        raise RuntimeError(f"PRODUCTION_CONFIG_INVALID missing={','.join(missing)}")


def _validate_image_bytes(image_bytes: bytes, field_name: str) -> None:
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > settings.request_max_pixels:
                raise HTTPException(status_code=413, detail=f"{field_name.upper()}_PIXEL_LIMIT")
            image.verify()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail=f"INVALID_{field_name.upper()}")


def _image_size(image_bytes: bytes) -> tuple[int, int]:
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            return image.size
    except Exception:
        return (0, 0)


def _quality_mode(value: Optional[str]) -> str:
    requested = (value or "standard").strip().lower()
    if requested != "standard":
        raise HTTPException(status_code=400, detail="INVALID_QUALITY")
    return "standard"


def _model_ready() -> bool:
    engine = settings.tryon_engine.strip().lower().replace("-", "_")
    if engine not in {"catvton", "cat_vton"}:
        return False
    upper_ready = os.path.isdir(settings.catvton_model_dir) and os.path.exists(
        os.path.join(settings.catvton_model_dir, "mix-48k-1024", "attention")
    )
    if not upper_ready or not settings.enable_lower_body:
        return upper_ready
    lower_engine = settings.lower_body_engine.strip().lower().replace("-", "_")
    if lower_engine in {"catvton", "cat_vton"}:
        return upper_ready
    if lower_engine in {"fashn", "fashn_vton", "fashn_vton_1_5"}:
        required = (
            os.path.join(settings.fashn_weights_dir, "model.safetensors"),
            os.path.join(settings.fashn_weights_dir, "dwpose", "yolox_l.onnx"),
            os.path.join(settings.fashn_weights_dir, "dwpose", "dw-ll_ucoco_384.onnx"),
            os.path.join(settings.fashn_weights_dir, "model-manifest.json"),
        )
        return all(os.path.isfile(path) for path in required)
    return False


def _worker_ready(connection) -> bool:
    required_queues = {settings.queue_name}
    if settings.enable_lower_body:
        required_queues.add(settings.lower_body_queue_name)
    ready_queues: set[str] = set()
    for worker in Worker.all(connection=connection):
        if worker.get_state() in {"idle", "busy"}:
            ready_queues.update(worker.queue_names())
    return required_queues <= ready_queues


def _is_admin(token: Optional[str]) -> bool:
    return bool(settings.admin_token) and hmac.compare_digest(token or "", settings.admin_token)


def _normalize_garment_type(value: Optional[str]) -> str:
    normalized = (value or "upper").strip().lower().replace("-", "_")
    if normalized in {"upper", "upper_body"}:
        return "upper"
    if normalized in {"lower", "lower_body"}:
        if not settings.enable_lower_body:
            raise HTTPException(status_code=400, detail="LOWER_BODY_NOT_ENABLED")
        return "lower"
    raise HTTPException(status_code=400, detail="UNSUPPORTED_GARMENT_TYPE")


def _normalize_lower_category(value: Optional[str]) -> Optional[str]:
    normalized = (value or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "denim_jeans": "jeans",
        "denim_pants": "jeans",
        "pant": "pants",
        "trouser": "trousers",
        "short": "shorts",
        "denim_shorts": "shorts",
        "mini_skirt": "skirt",
        "pencil_skirt": "skirt",
        "a_line_skirt": "skirt",
        "legging": "leggings",
        "tights": "leggings",
        "yoga_pants": "leggings",
        "jogger": "joggers",
        "sweatpants": "joggers",
        "track_pants": "joggers",
    }
    normalized = aliases.get(normalized, normalized)
    allowed = {item.strip().lower() for item in settings.lower_body_allowed_categories.split(",") if item.strip()}
    if not normalized:
        return None
    if normalized not in allowed:
        raise HTTPException(status_code=422, detail="GARMENT_INVALID:LOWER_BODY_CATEGORY_NOT_ALLOWED")
    return normalized


def _tryon_profile_type(garment_type: str, garment_category: Optional[str]) -> str:
    if garment_type != "lower":
        return garment_type
    category = _normalize_lower_category(garment_category)
    return f"lower:{category}" if category else "lower"


def _validate_person_for_garment_type(person_bytes: bytes, garment_type: str) -> None:
    if garment_type == "upper":
        if settings.enforce_upper_body:
            ok, reason = is_upper_body(person_bytes)
            if not ok:
                raise HTTPException(status_code=400, detail=f"UPPER_BODY_ONLY:{reason}")
        return

    result = validate_lower_body_person(person_bytes)
    if not result.ok:
        raise HTTPException(status_code=400, detail=f"LOWER_BODY_INVALID:{result.reason}")


def _ensure_lower_garment_rule_allowed(rule_key: str, support_level: str, garment_type: str) -> None:
    if support_level != "future_lower_beta":
        return
    allowed = {item.strip() for item in settings.lower_body_allowed_categories.split(",") if item.strip()}
    if garment_type != "lower" or rule_key not in allowed:
        raise HTTPException(status_code=422, detail="GARMENT_INVALID:LOWER_BODY_NOT_ENABLED")


def _cache_version_for_garment_type(garment_type: str) -> str:
    if garment_type == "lower":
        return settings.lower_body_cache_version
    return settings.garment_cache_version


def _rule_warnings(rule) -> list[str]:
    if rule.support_level == "beta":
        return [f"BETA_CATEGORY:{rule.key.upper()}"]
    if rule.support_level == "future_lower_beta":
        return [f"LOWER_BODY_V1_CATEGORY:{rule.key.upper()}", "LOWER_BODY_V1_REVIEW_REQUIRED"]
    return []


_require_production_config()


@app.middleware("http")
async def request_logger(request, call_next):
    request_id = _request_id(request.headers.get("x-request-id"))
    request.state.request_id = request_id
    if request.url.path.startswith("/ai/"):
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                declared_length = int(content_length)
                if declared_length < 0:
                    raise ValueError
                if declared_length > settings.request_max_bytes * 2 + _UPLOAD_READ_CHUNK_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "REQUEST_BODY_TOO_LARGE"},
                        headers={"x-request-id": request_id},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "INVALID_CONTENT_LENGTH"},
                    headers={"x-request-id": request_id},
                )
    if request.url.path.startswith("/ai/") and settings.ai_service_token:
        token = request.headers.get("x-drapixai-service-token", "")
        if not hmac.compare_digest(token, settings.ai_service_token):
            logger.warning(
                "ai_service_token_rejected",
                extra={
                    "path": request.url.path,
                    "method": request.method,
                    "request_id": request_id,
                },
            )
            return JSONResponse(
                status_code=401,
                content={"detail": "AI_SERVICE_TOKEN_REQUIRED"},
                headers={"x-request-id": request_id},
            )
    start = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - start) * 1000)
    response.headers["x-request-id"] = request_id
    if request.url.path.startswith("/ai/"):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
    logger.info(
        "request_complete",
        extra={
            "path": request.url.path,
            "method": request.method,
            "status": response.status_code,
            "duration_ms": duration_ms,
            "request_id": request_id,
        },
    )
    return response


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/ready")
async def ready(x_drapixai_service_token: Optional[str] = Header(default=None)) -> Response:
    include_details = not _is_production() or (
        bool(settings.ai_service_token)
        and hmac.compare_digest(x_drapixai_service_token or "", settings.ai_service_token)
    )
    try:
        connection = get_redis()
        connection.ping()
        model_ready = _model_ready()
        worker_ready = _worker_ready(connection)
        payload = _ready_payload(model_ready, worker_ready, include_details)
        return JSONResponse(payload, status_code=200 if model_ready and worker_ready else 503)
    except Exception:
        return JSONResponse(
            _ready_payload(_model_ready(), False, include_details),
            status_code=503,
        )


@app.post("/ai/tryon")
async def tryon(
    request: Request,
    user_id: str = Form(...),
    person_image: UploadFile = File(...),
    cloth_image: Optional[UploadFile] = File(default=None),
    quality: Optional[str] = Form(default=None),
    garment_type: Optional[str] = Form(default=None),
    garment_category: Optional[str] = Form(default=None),
    cloth_cache_key: Optional[str] = Form(default=None),
):
    quality_mode = _quality_mode(quality)
    person_bytes = await _read_upload_limited(person_image, "person_image")
    cloth_bytes = b""
    garment_source = "direct_upload"
    if cloth_cache_key:
        hit = garment_cache.get(cloth_cache_key)
        if not hit:
            raise HTTPException(status_code=404, detail="GARMENT_CACHE_MISS")
        cloth_bytes = hit.image_bytes
        garment_source = "cache"
    elif cloth_image is not None:
        cloth_bytes = await _read_upload_limited(cloth_image, "cloth_image")
    else:
        raise HTTPException(status_code=400, detail="CLOTH_IMAGE_REQUIRED")

    if len(person_bytes) > settings.request_max_bytes or len(cloth_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
    _validate_image_bytes(person_bytes, "person_image")
    _validate_image_bytes(cloth_bytes, "cloth_image")

    normalized_garment_type = _normalize_garment_type(garment_type)
    profile_garment_type = _tryon_profile_type(normalized_garment_type, garment_category)
    _validate_person_for_garment_type(person_bytes, normalized_garment_type)

    try:
        job = service.enqueue_tryon(
            user_id=user_id,
            person_bytes=person_bytes,
            cloth_bytes=cloth_bytes,
            quality=quality_mode,
            request_id=getattr(request.state, "request_id", None),
            garment_type=profile_garment_type,
        )
    except PermissionError:
        raise HTTPException(status_code=429, detail="TRY_ON_LIMIT_EXCEEDED")

    try:
        result = await asyncio.to_thread(service.wait_for_result, job)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="TRY_ON_TIMEOUT")
    except RuntimeError:
        raise HTTPException(status_code=500, detail="TRY_ON_FAILED")

    logger.info(
        "tryon_result_metadata",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "engine": result.get("engine"),
            "quality_score": result.get("quality_score"),
            "candidate_count": result.get("candidate_count"),
            "warnings": result.get("warnings", []),
            "processing_ms": result.get("processing_ms"),
            "timings": result.get("timings", {}),
        },
    )
    image_bytes = base64.b64decode(result["image_base64"])
    metadata = result.get("metadata", {}) if isinstance(result.get("metadata"), dict) else {}
    quality_metrics = {
        key: value
        for key, value in metadata.items()
        if key
        in {
            "face_preservation",
            "body_preservation",
            "garment_color_similarity",
            "garment_texture_similarity",
            "edge_quality",
            "artifact_score",
            "rectangular_artifact_score",
            "background_cast_score",
            "overall_realism",
            "garment_structure",
            "hem_quality",
            "untucked_hem_presence",
            "long_sleeve_preservation",
            "pose_preservation",
            "garment_coverage",
            "upper_body_preservation",
            "shoe_preservation",
            "waistband_alignment",
            "left_leg_integrity",
            "right_leg_integrity",
            "knee_preservation",
            "ankle_preservation",
            "lower_garment_color_similarity",
            "lower_garment_texture_similarity",
            "lower_garment_coverage",
            "hem_alignment",
            "crotch_artifact_score",
            "lower_body_category_profile",
            "jeans_profile_score",
            "pants_profile_score",
            "trousers_profile_score",
            "shorts_profile_score",
            "skirt_profile_score",
            "leggings_profile_score",
            "joggers_profile_score",
        }
    }
    headers = {
        "x-drapixai-engine": str(result.get("engine", "")),
        "x-drapixai-quality-score": str(result.get("quality_score", "")),
        "x-drapixai-candidate-count": str(result.get("candidate_count", "")),
        "x-drapixai-warnings": ",".join(result.get("warnings", [])),
        "x-drapixai-processing-ms": str(result.get("processing_ms", "")),
        "x-drapixai-timing-json": json.dumps(result.get("timings", {}), separators=(",", ":")),
        "x-drapixai-quality-json": json.dumps(quality_metrics, separators=(",", ":")),
        "x-drapixai-quality-mode": quality_mode,
        "x-drapixai-quality-profile": str(metadata.get("quality_profile", "")),
        "x-drapixai-garment-source": garment_source,
        "x-drapixai-media-retention": "transient-only",
        "x-drapixai-training-use": "none",
    }
    return Response(content=image_bytes, media_type=f"image/{result['format']}", headers=headers)


@app.post("/ai/tryon/base64")
async def tryon_base64(payload: TryOnBase64Request, request: Request):
    quality_mode = _quality_mode(payload.quality)
    normalized_garment_type = _normalize_garment_type(payload.garment_type)
    profile_garment_type = _tryon_profile_type(normalized_garment_type, payload.garment_category)

    person_bytes = _decode_base64_image(payload.person_image_base64, "person_image")
    if len(person_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
    _validate_image_bytes(person_bytes, "person_image")
    _validate_person_for_garment_type(person_bytes, normalized_garment_type)

    cloth_bytes = b""
    garment_source = "direct_upload"
    if payload.cloth_cache_key:
        hit = garment_cache.get(payload.cloth_cache_key)
        if not hit:
            raise HTTPException(status_code=404, detail="GARMENT_CACHE_MISS")
        if len(hit.image_bytes) > settings.request_max_bytes:
            raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
        _validate_image_bytes(hit.image_bytes, "cloth_image")
        cloth_bytes = hit.image_bytes
        garment_source = "cache"
    else:
        cloth_bytes = _decode_base64_image(payload.cloth_image_base64, "cloth_image")
        if len(cloth_bytes) > settings.request_max_bytes:
            raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
        _validate_image_bytes(cloth_bytes, "cloth_image")

    try:
        job = service.enqueue_tryon(
            user_id=payload.user_id,
            person_bytes=person_bytes,
            cloth_bytes=cloth_bytes,
            quality=quality_mode,
            request_id=getattr(request.state, "request_id", None),
            garment_type=profile_garment_type,
        )
    except PermissionError:
        raise HTTPException(status_code=429, detail="TRY_ON_LIMIT_EXCEEDED")

    try:
        result = await asyncio.to_thread(service.wait_for_result, job)
    except TimeoutError:
        raise HTTPException(status_code=504, detail="TRY_ON_TIMEOUT")
    except RuntimeError:
        raise HTTPException(status_code=500, detail="TRY_ON_FAILED")

    logger.info(
        "tryon_result_metadata",
        extra={
            "request_id": getattr(request.state, "request_id", None),
            "engine": result.get("engine"),
            "quality_score": result.get("quality_score"),
            "candidate_count": result.get("candidate_count"),
            "warnings": result.get("warnings", []),
            "processing_ms": result.get("processing_ms"),
            "timings": result.get("timings", {}),
        },
    )
    image_bytes = base64.b64decode(result["image_base64"])
    metadata = result.get("metadata", {}) if isinstance(result.get("metadata"), dict) else {}
    quality_metrics = {
        key: value
        for key, value in metadata.items()
        if key
        in {
            "face_preservation",
            "body_preservation",
            "garment_color_similarity",
            "garment_texture_similarity",
            "edge_quality",
            "artifact_score",
            "rectangular_artifact_score",
            "background_cast_score",
            "overall_realism",
            "garment_structure",
            "hem_quality",
            "untucked_hem_presence",
            "long_sleeve_preservation",
            "pose_preservation",
            "garment_coverage",
            "upper_body_preservation",
            "shoe_preservation",
            "waistband_alignment",
            "left_leg_integrity",
            "right_leg_integrity",
            "knee_preservation",
            "ankle_preservation",
            "lower_garment_color_similarity",
            "lower_garment_texture_similarity",
            "lower_garment_coverage",
            "hem_alignment",
            "crotch_artifact_score",
            "lower_body_category_profile",
            "jeans_profile_score",
            "pants_profile_score",
            "trousers_profile_score",
            "shorts_profile_score",
            "skirt_profile_score",
            "leggings_profile_score",
            "joggers_profile_score",
        }
    }
    headers = {
        "x-drapixai-engine": str(result.get("engine", "")),
        "x-drapixai-quality-score": str(result.get("quality_score", "")),
        "x-drapixai-candidate-count": str(result.get("candidate_count", "")),
        "x-drapixai-warnings": ",".join(result.get("warnings", [])),
        "x-drapixai-processing-ms": str(result.get("processing_ms", "")),
        "x-drapixai-timing-json": json.dumps(result.get("timings", {}), separators=(",", ":")),
        "x-drapixai-quality-json": json.dumps(quality_metrics, separators=(",", ":")),
        "x-drapixai-quality-mode": quality_mode,
        "x-drapixai-quality-profile": str(metadata.get("quality_profile", "")),
        "x-drapixai-garment-source": garment_source,
        "x-drapixai-media-retention": "transient-only",
        "x-drapixai-training-use": "none",
    }
    return Response(content=image_bytes, media_type=f"image/{result['format']}", headers=headers)


@app.post("/ai/garment/preprocess")
async def garment_preprocess(
    cloth_image: UploadFile = File(...),
    brand_id: Optional[str] = Form(default=None),
    garment_id: Optional[str] = Form(default=None),
    category: Optional[str] = Form(default=None),
    product_name: Optional[str] = Form(default=None),
    garment_profile: Optional[str] = Form(default=None),
    garment_type: Optional[str] = Form(default=None),
    admin_bypass: Optional[bool] = Form(default=False),
    x_admin_token: Optional[str] = Header(default=None),
):
    cloth_bytes = await _read_upload_limited(cloth_image, "cloth_image")
    _validate_image_bytes(cloth_bytes, "cloth_image")
    if len(cloth_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    image_hash = garment_cache.compute_hash(cloth_bytes)
    normalized_garment_type = _normalize_garment_type(garment_type)
    rule = resolve_garment_rule(garment_profile, category, product_name, garment_id)
    _ensure_lower_garment_rule_allowed(rule.key, rule.support_level, normalized_garment_type)
    cache_key = garment_cache.build_key(
        image_hash,
        brand_id,
        garment_id,
        rule.key,
        version=_cache_version_for_garment_type(normalized_garment_type),
    )
    cache_hit = garment_cache.get(cache_key)
    if cache_hit:
        return {
            "did_process": False,
            "reason": "CACHE_HIT",
            "cache_key": cache_key,
            "image_base64": base64.b64encode(cache_hit.image_bytes).decode("utf-8"),
            "profile_key": rule.key,
            "profile_label": rule.label,
            "support_level": rule.support_level,
            "garment_type": normalized_garment_type,
            "warnings": _rule_warnings(rule),
        }

    bypass_allowed = bool(admin_bypass) and bool(settings.admin_token) and settings.admin_token == (x_admin_token or "")
    try:
        result = preprocess_garment(
            cloth_bytes,
            bypass_validation=bypass_allowed,
            options=GarmentPreprocessOptions(
                garment_profile=garment_profile,
                category_hint=category,
                product_name=product_name,
                garment_id=garment_id,
                garment_type=normalized_garment_type,
            ),
        )
    except GarmentValidationError as exc:
        raise HTTPException(status_code=422, detail=f"GARMENT_INVALID:{exc.reason}")
    output = io.BytesIO()
    result.image.save(output, format="PNG")
    processed_bytes = output.getvalue()
    garment_cache.put(cache_key, processed_bytes)
    return {
        "did_process": result.did_process,
        "reason": result.reason,
        "cache_key": cache_key,
        "image_base64": base64.b64encode(processed_bytes).decode("utf-8"),
        "profile_key": result.profile_key,
        "profile_label": result.profile_label,
        "support_level": result.support_level,
        "garment_type": normalized_garment_type,
        "warnings": list(result.warnings),
    }


@app.get("/ai/garment/cache")
async def garment_cache_get(cache_key: str):
    hit = garment_cache.get(cache_key)
    if not hit:
        raise HTTPException(status_code=404, detail="GARMENT_CACHE_MISS")
    width, height = _image_size(hit.image_bytes)
    headers = {
        "x-drapixai-cache-key": cache_key,
        "x-drapixai-cache-version": cache_key.split(":", 1)[0] if ":" in cache_key else "",
        "x-drapixai-cache-width": str(width),
        "x-drapixai-cache-height": str(height),
    }
    return Response(content=hit.image_bytes, media_type="image/png", headers=headers)


@app.get("/ai/garment/cache/health")
async def garment_cache_health(x_admin_token: Optional[str] = Header(default=None)):
    if not _is_admin(x_admin_token):
        raise HTTPException(status_code=403, detail="ADMIN_REQUIRED")
    return garment_cache.health_check()


@app.post("/ai/garment/cache/delete")
async def garment_cache_delete(payload: GarmentCacheDeleteRequest):
    return {"deleted": garment_cache.delete(payload.cache_key)}


@app.post("/ai/garment/preprocess/base64")
async def garment_preprocess_base64(
    payload: GarmentBase64Request,
    x_admin_token: Optional[str] = Header(default=None),
):
    cloth_bytes = _decode_base64_image(payload.cloth_image_base64, "cloth_image")
    _validate_image_bytes(cloth_bytes, "cloth_image")
    if len(cloth_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    image_hash = garment_cache.compute_hash(cloth_bytes)
    normalized_garment_type = _normalize_garment_type(payload.garment_type)
    rule = resolve_garment_rule(payload.garment_profile, payload.category, payload.product_name, payload.garment_id)
    _ensure_lower_garment_rule_allowed(rule.key, rule.support_level, normalized_garment_type)
    cache_key = garment_cache.build_key(
        image_hash,
        payload.brand_id,
        payload.garment_id,
        rule.key,
        version=_cache_version_for_garment_type(normalized_garment_type),
    )
    cache_hit = garment_cache.get(cache_key)
    if cache_hit:
        return {
            "did_process": False,
            "reason": "CACHE_HIT",
            "cache_key": cache_key,
            "image_base64": base64.b64encode(cache_hit.image_bytes).decode("utf-8"),
            "profile_key": rule.key,
            "profile_label": rule.label,
            "support_level": rule.support_level,
            "garment_type": normalized_garment_type,
            "warnings": _rule_warnings(rule),
        }

    bypass_allowed = bool(payload.admin_bypass) and bool(settings.admin_token) and settings.admin_token == (x_admin_token or "")
    try:
        result = preprocess_garment(
            cloth_bytes,
            bypass_validation=bypass_allowed,
            options=GarmentPreprocessOptions(
                garment_profile=payload.garment_profile,
                category_hint=payload.category,
                product_name=payload.product_name,
                garment_id=payload.garment_id,
                garment_type=normalized_garment_type,
            ),
        )
    except GarmentValidationError as exc:
        raise HTTPException(status_code=422, detail=f"GARMENT_INVALID:{exc.reason}")

    output = io.BytesIO()
    result.image.save(output, format="PNG")
    processed_bytes = output.getvalue()
    garment_cache.put(cache_key, processed_bytes)
    return {
        "did_process": result.did_process,
        "reason": result.reason,
        "cache_key": cache_key,
        "image_base64": base64.b64encode(processed_bytes).decode("utf-8"),
        "profile_key": result.profile_key,
        "profile_label": result.profile_label,
        "support_level": result.support_level,
        "garment_type": normalized_garment_type,
        "warnings": list(result.warnings),
    }
