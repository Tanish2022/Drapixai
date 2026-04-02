from __future__ import annotations

import io
from typing import Tuple

import numpy as np
from PIL import Image

from drapixai_ai.configs.settings import settings


def _edge_density(gray: np.ndarray) -> float:
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    return float(gx.mean() + gy.mean())


def is_upper_body(image_bytes: bytes) -> Tuple[bool, str]:
    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("L")
    except Exception:
        return False, "INVALID_IMAGE"

    w, h = img.size
    if h == 0 or w == 0:
        return False, "INVALID_DIMENSIONS"

    if h / w < settings.upper_body_min_ratio:
        return False, "ASPECT_RATIO"

    arr = np.asarray(img, dtype=np.float32)
    mid = h // 2
    top = arr[:mid, :]
    bottom = arr[mid:, :]

    top_edges = _edge_density(top)
    bottom_edges = _edge_density(bottom)
    if bottom_edges == 0:
        return True, "OK"

    if top_edges / bottom_edges < settings.upper_body_edge_ratio:
        return False, "EDGE_RATIO"

    return True, "OK"