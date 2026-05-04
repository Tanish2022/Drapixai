from __future__ import annotations

import base64
import io
import os
import time
import uuid
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request, Header
from fastapi.responses import Response
from pydantic import BaseModel, Field

from drapixai_ai.configs.settings import settings
from drapixai_ai.queue.redis_queue import get_redis
from drapixai_ai.services.garment_cache import GarmentCache
from drapixai_ai.services.garment_preprocessor import (
    GarmentPreprocessOptions,
    GarmentValidationError,
    preprocess_garment,
)
from drapixai_ai.services.garment_rules import resolve_garment_rule
from drapixai_ai.services.logger import get_logger
from drapixai_ai.services.tryon_service import TryOnService
from drapixai_ai.services.upper_body_validator import is_upper_body

app = FastAPI(title="DrapixAI", version="1.0.0")
service = TryOnService()
garment_cache = GarmentCache()
logger = get_logger("drapixai_ai.api")


class TryOnBase64Request(BaseModel):
    user_id: str = Field(..., min_length=1)
    person_image_base64: str = Field(..., min_length=1)
    cloth_image_base64: Optional[str] = Field(default=None)
    quality: Optional[str] = Field(default=None)
    garment_type: Optional[str] = Field(default=None)
    cloth_cache_key: Optional[str] = Field(default=None)


class GarmentBase64Request(BaseModel):
    cloth_image_base64: str = Field(..., min_length=1)
    brand_id: Optional[str] = Field(default=None)
    garment_id: Optional[str] = Field(default=None)
    category: Optional[str] = Field(default=None)
    product_name: Optional[str] = Field(default=None)
    garment_profile: Optional[str] = Field(default=None)
    admin_bypass: Optional[bool] = Field(default=False)


def _decode_base64_image(value: Optional[str], field_name: str) -> bytes:
    if not value:
        raise HTTPException(status_code=400, detail=f"{field_name.upper()}_REQUIRED")

    try:
        return base64.b64decode(value, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail=f"INVALID_{field_name.upper()}")


def _model_ready() -> bool:
    engine = settings.tryon_engine.strip().lower().replace("-", "_")
    if engine not in {"catvton", "cat_vton"}:
        return False
    return os.path.isdir(settings.catvton_model_dir) and os.path.exists(
        os.path.join(settings.catvton_model_dir, "mix-48k-1024", "attention")
    )


def _is_admin(token: Optional[str]) -> bool:
    return bool(settings.admin_token) and token == settings.admin_token


@app.middleware("http")
async def request_logger(request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    request.state.request_id = request_id
    start = time.time()
    response = await call_next(request)
    duration_ms = int((time.time() - start) * 1000)
    response.headers["x-request-id"] = request_id
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
async def ready() -> dict:
    try:
        get_redis().ping()
        return {"status": "ready", "model_ready": _model_ready(), "engine": settings.tryon_engine}
    except Exception:
        return {"status": "not_ready", "model_ready": _model_ready(), "engine": settings.tryon_engine}


@app.post("/ai/tryon")
async def tryon(
    request: Request,
    user_id: str = Form(...),
    person_image: UploadFile = File(...),
    cloth_image: Optional[UploadFile] = File(default=None),
    quality: Optional[str] = Form(default=None),
    garment_type: Optional[str] = Form(default=None),
    cloth_cache_key: Optional[str] = Form(default=None),
):
    person_bytes = await person_image.read()
    cloth_bytes = b""
    if cloth_cache_key:
        hit = garment_cache.get(cloth_cache_key)
        if not hit:
            raise HTTPException(status_code=404, detail="GARMENT_CACHE_MISS")
        cloth_bytes = hit.image_bytes
    elif cloth_image is not None:
        cloth_bytes = await cloth_image.read()
    else:
        raise HTTPException(status_code=400, detail="CLOTH_IMAGE_REQUIRED")

    if len(person_bytes) > settings.request_max_bytes or len(cloth_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    if garment_type and garment_type.lower() != "upper":
        raise HTTPException(status_code=400, detail="UPPER_BODY_ONLY")

    if settings.enforce_upper_body and (garment_type or "upper").lower() == "upper":
        ok, reason = is_upper_body(person_bytes)
        if not ok:
            raise HTTPException(status_code=400, detail=f"UPPER_BODY_ONLY:{reason}")

    try:
        job = service.enqueue_tryon(
            user_id=user_id,
            person_b64=base64.b64encode(person_bytes).decode("utf-8"),
            cloth_b64=base64.b64encode(cloth_bytes).decode("utf-8"),
            quality=quality,
            request_id=getattr(request.state, "request_id", None),
            garment_type=garment_type,
        )
    except PermissionError:
        raise HTTPException(status_code=429, detail="TRY_ON_LIMIT_EXCEEDED")

    try:
        result = service.wait_for_result(job)
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
        },
    )
    image_bytes = base64.b64decode(result["image_base64"])
    headers = {
        "x-drapixai-engine": str(result.get("engine", "")),
        "x-drapixai-quality-score": str(result.get("quality_score", "")),
        "x-drapixai-candidate-count": str(result.get("candidate_count", "")),
        "x-drapixai-warnings": ",".join(result.get("warnings", [])),
    }
    return Response(content=image_bytes, media_type=f"image/{result['format']}", headers=headers)


@app.post("/ai/tryon/base64")
async def tryon_base64(payload: TryOnBase64Request, request: Request):
    if payload.garment_type and payload.garment_type.lower() != "upper":
        raise HTTPException(status_code=400, detail="UPPER_BODY_ONLY")

    person_bytes = _decode_base64_image(payload.person_image_base64, "person_image")
    if settings.enforce_upper_body and (payload.garment_type or "upper").lower() == "upper":
        ok, reason = is_upper_body(person_bytes)
        if not ok:
            raise HTTPException(status_code=400, detail=f"UPPER_BODY_ONLY:{reason}")

    if len(person_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    cloth_b64 = payload.cloth_image_base64 or ""
    if payload.cloth_cache_key:
        hit = garment_cache.get(payload.cloth_cache_key)
        if not hit:
            raise HTTPException(status_code=404, detail="GARMENT_CACHE_MISS")
        if len(hit.image_bytes) > settings.request_max_bytes:
            raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
        cloth_b64 = base64.b64encode(hit.image_bytes).decode("utf-8")
    else:
        cloth_bytes = _decode_base64_image(payload.cloth_image_base64, "cloth_image")
        if len(cloth_bytes) > settings.request_max_bytes:
            raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")
        cloth_b64 = base64.b64encode(cloth_bytes).decode("utf-8")

    try:
        job = service.enqueue_tryon(
            user_id=payload.user_id,
            person_b64=payload.person_image_base64,
            cloth_b64=cloth_b64,
            quality=payload.quality,
            request_id=getattr(request.state, "request_id", None),
            garment_type=payload.garment_type,
        )
    except PermissionError:
        raise HTTPException(status_code=429, detail="TRY_ON_LIMIT_EXCEEDED")

    try:
        result = service.wait_for_result(job)
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
        },
    )
    image_bytes = base64.b64decode(result["image_base64"])
    headers = {
        "x-drapixai-engine": str(result.get("engine", "")),
        "x-drapixai-quality-score": str(result.get("quality_score", "")),
        "x-drapixai-candidate-count": str(result.get("candidate_count", "")),
        "x-drapixai-warnings": ",".join(result.get("warnings", [])),
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
    admin_bypass: Optional[bool] = Form(default=False),
    x_admin_token: Optional[str] = Header(default=None),
):
    cloth_bytes = await cloth_image.read()
    if len(cloth_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    image_hash = garment_cache.compute_hash(cloth_bytes)
    rule = resolve_garment_rule(garment_profile, category, product_name, garment_id)
    cache_key = garment_cache.build_key(image_hash, brand_id, garment_id, rule.key)
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
            "warnings": [f"BETA_CATEGORY:{rule.key.upper()}"] if rule.support_level == "beta" else [],
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
        "warnings": list(result.warnings),
    }


@app.get("/ai/garment/cache")
async def garment_cache_get(cache_key: str):
    hit = garment_cache.get(cache_key)
    if not hit:
        raise HTTPException(status_code=404, detail="GARMENT_CACHE_MISS")
    return Response(content=hit.image_bytes, media_type="image/png")


@app.get("/ai/garment/cache/health")
async def garment_cache_health(x_admin_token: Optional[str] = Header(default=None)):
    if not _is_admin(x_admin_token):
        raise HTTPException(status_code=403, detail="ADMIN_REQUIRED")
    return garment_cache.health_check()


@app.post("/ai/garment/preprocess/base64")
async def garment_preprocess_base64(
    payload: GarmentBase64Request,
    x_admin_token: Optional[str] = Header(default=None),
):
    cloth_bytes = _decode_base64_image(payload.cloth_image_base64, "cloth_image")
    if len(cloth_bytes) > settings.request_max_bytes:
        raise HTTPException(status_code=413, detail="IMAGE_TOO_LARGE")

    image_hash = garment_cache.compute_hash(cloth_bytes)
    rule = resolve_garment_rule(payload.garment_profile, payload.category, payload.product_name, payload.garment_id)
    cache_key = garment_cache.build_key(image_hash, payload.brand_id, payload.garment_id, rule.key)
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
            "warnings": [f"BETA_CATEGORY:{rule.key.upper()}"] if rule.support_level == "beta" else [],
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
        "warnings": list(result.warnings),
    }
