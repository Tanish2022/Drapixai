from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from typing import Union

import requests


@dataclass(frozen=True)
class TryOnMetadata:
    result_id: str = ""
    engine: str = ""
    quality_score: float | None = None
    candidate_count: int | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class TryOnResponse:
    image_bytes: bytes
    metadata: TryOnMetadata
    content_type: str = "image/png"


class DrapixAI:
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        api_base_url: str | None = None,
    ) -> None:
        self.base_url = (base_url or os.getenv("DRAPIXAI_AI_URL", "http://localhost:8080")).rstrip("/")
        self.api_base_url = (api_base_url or os.getenv("DRAPIXAI_API_URL", "http://localhost:8000")).rstrip("/")
        self.api_key = api_key

    def generate_tryon(
        self,
        user_id: str,
        person_image: Union[str, bytes],
        cloth_image: Union[str, bytes],
        quality: str = "enhanced",
        garment_type: str = "upper",
        timeout: int = 180,
    ) -> bytes:
        """Generate a direct AI-service try-on and return only image bytes.

        This preserves the original SDK behavior. For production storefront API
        calls with metadata, use generate_storefront_tryon().
        """

        return self.generate_tryon_with_metadata(
            user_id=user_id,
            person_image=person_image,
            cloth_image=cloth_image,
            quality=quality,
            garment_type=garment_type,
            timeout=timeout,
        ).image_bytes

    def generate_tryon_with_metadata(
        self,
        user_id: str,
        person_image: Union[str, bytes],
        cloth_image: Union[str, bytes],
        quality: str = "enhanced",
        garment_type: str = "upper",
        timeout: int = 180,
    ) -> TryOnResponse:
        person_bytes = self._load_image(person_image)
        cloth_bytes = self._load_image(cloth_image)

        files = {
            "person_image": ("person.jpg", person_bytes, "image/jpeg"),
            "cloth_image": ("cloth.jpg", cloth_bytes, "image/jpeg"),
        }
        data = {"user_id": user_id, "quality": quality, "garment_type": garment_type}

        resp = requests.post(f"{self.base_url}/ai/tryon", files=files, data=data, timeout=timeout)
        if resp.status_code != 200:
            raise RuntimeError(resp.text)
        return TryOnResponse(
            image_bytes=resp.content,
            metadata=self._metadata_from_headers(resp.headers),
            content_type=resp.headers.get("content-type", "image/png"),
        )

    def generate_storefront_tryon(
        self,
        person_image: Union[str, bytes],
        *,
        product_id: str | None = None,
        garment_id: str | None = None,
        cloth_cache_key: str | None = None,
        cloth_image: Union[str, bytes, None] = None,
        quality: str = "enhanced",
        garment_type: str = "upper",
        timeout: int = 240,
    ) -> TryOnResponse:
        """Call the Node/Express storefront SDK API and return image + metadata."""

        if not self.api_key:
            raise RuntimeError("API key required for /sdk/tryon")
        if not product_id and not garment_id and not cloth_cache_key and cloth_image is None:
            raise ValueError("Provide product_id, garment_id, cloth_cache_key, or cloth_image")

        files: dict[str, tuple[str, bytes, str]] = {
            "person_image": ("person.jpg", self._load_image(person_image), "image/jpeg"),
        }
        if cloth_image is not None:
            files["cloth_image"] = ("cloth.jpg", self._load_image(cloth_image), "image/jpeg")

        data: dict[str, str] = {"quality": quality, "garment_type": garment_type}
        if product_id:
            data["productId"] = product_id
        if garment_id:
            data["garment_id"] = garment_id
        if cloth_cache_key:
            data["cloth_cache_key"] = cloth_cache_key

        resp = requests.post(
            f"{self.api_base_url}/sdk/tryon",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=timeout,
        )
        if resp.status_code != 200:
            raise RuntimeError(resp.text)
        return TryOnResponse(
            image_bytes=resp.content,
            metadata=self._metadata_from_headers(resp.headers),
            content_type=resp.headers.get("content-type", "image/png"),
        )

    def preprocess_garment(
        self,
        cloth_image: Union[str, bytes],
        brand_id: str | None = None,
        garment_id: str | None = None,
        admin_bypass: bool = False,
        admin_token: str | None = None,
        timeout: int = 120,
    ) -> tuple[bytes, bool, str, str]:
        cloth_bytes = self._load_image(cloth_image)
        files = {"cloth_image": ("cloth.png", cloth_bytes, "image/png")}
        data = {}
        if brand_id:
            data["brand_id"] = brand_id
        if garment_id:
            data["garment_id"] = garment_id
        if admin_bypass:
            data["admin_bypass"] = "true"
        headers = {}
        if admin_token:
            headers["x-admin-token"] = admin_token
        resp = requests.post(
            f"{self.base_url}/ai/garment/preprocess",
            files=files,
            data=data,
            headers=headers,
            timeout=timeout,
        )
        if resp.status_code != 200:
            raise RuntimeError(resp.text)
        payload = resp.json()
        image_bytes = base64.b64decode(payload["image_base64"])
        return (
            image_bytes,
            bool(payload.get("did_process")),
            str(payload.get("reason", "")),
            str(payload.get("cache_key", "")),
        )

    @staticmethod
    def _load_image(value: Union[str, bytes]) -> bytes:
        if isinstance(value, bytes):
            return value
        if not os.path.exists(value):
            raise FileNotFoundError(value)
        with open(value, "rb") as f:
            return f.read()

    @staticmethod
    def _metadata_from_headers(headers: requests.structures.CaseInsensitiveDict) -> TryOnMetadata:
        def parse_float(value: str | None) -> float | None:
            if not value:
                return None
            try:
                return float(value)
            except ValueError:
                return None

        def parse_int(value: str | None) -> int | None:
            if not value:
                return None
            try:
                return int(float(value))
            except ValueError:
                return None

        warnings = headers.get("x-drapixai-warnings", "")
        return TryOnMetadata(
            result_id=headers.get("x-drapixai-tryon-result-id", ""),
            engine=headers.get("x-drapixai-engine", ""),
            quality_score=parse_float(headers.get("x-drapixai-quality-score")),
            candidate_count=parse_int(headers.get("x-drapixai-candidate-count")),
            warnings=[item.strip() for item in warnings.split(",") if item.strip()],
        )
