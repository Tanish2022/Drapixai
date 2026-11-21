import hmac
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError

from drapixai_ai.configs.settings import settings
from drapixai_ai.queue.redis_queue import tryon_queue_depth

router = APIRouter()


@router.get("/internal/queue-depth", include_in_schema=False)
def queue_depth(x_drapixai_service_token: Optional[str] = Header(default=None)) -> JSONResponse:
    token = settings.ai_service_token
    if not token or not hmac.compare_digest((x_drapixai_service_token or "").encode(), token.encode()):
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    try:
        depth = tryon_queue_depth()
    except RedisError:
        raise HTTPException(status_code=503, detail="QUEUE_DEPTH_UNAVAILABLE") from None
    return JSONResponse({"depth": depth}, headers={"Cache-Control": "no-store"})
