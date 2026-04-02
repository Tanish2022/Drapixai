from __future__ import annotations

import base64
import os
from typing import Union

import requests


class DrapixAI:
    def __init__(self, base_url: str = "http://localhost:8080") -> None:
        self.base_url = base_url.rstrip("/")

    def generate_tryon(
        self,
        user_id: str,
        person_image: Union[str, bytes],
        cloth_image: Union[str, bytes],
        quality: str = "enhanced",
        garment_type: str = "upper",
        timeout: int = 180,
    ) -> bytes:
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
        return resp.content

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
