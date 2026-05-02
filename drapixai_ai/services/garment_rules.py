from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class GarmentRule:
    key: str
    label: str
    support_level: str
    aliases: tuple[str, ...]
    min_width: int = 512
    min_height: int = 512
    min_fg_ratio: float = 0.08
    max_fg_ratio: float = 0.9
    max_aspect_ratio: float = 1.75
    crop_padding_ratio: float = 0.12
    skin_ratio_threshold: float = 0.04
    top_skin_ratio_threshold: float = 0.12


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().replace("-", " ").replace("_", " ").split())


GARMENT_RULES: tuple[GarmentRule, ...] = (
    GarmentRule(
        key="shirt",
        label="Shirt",
        support_level="launch_ready",
        aliases=("oxford shirt", "button down", "button up", "buttonup", "shirt", "flannel"),
        min_fg_ratio=0.12,
        max_fg_ratio=0.82,
        max_aspect_ratio=1.62,
        crop_padding_ratio=0.1,
        skin_ratio_threshold=0.03,
        top_skin_ratio_threshold=0.08,
    ),
    GarmentRule(
        key="tshirt",
        label="T-Shirt",
        support_level="launch_ready",
        aliases=("t shirt", "tshirt", "tee shirt", "graphic tee", "tee"),
        min_fg_ratio=0.12,
        max_fg_ratio=0.82,
        max_aspect_ratio=1.45,
        crop_padding_ratio=0.09,
        skin_ratio_threshold=0.03,
        top_skin_ratio_threshold=0.09,
    ),
    GarmentRule(
        key="polo",
        label="Polo",
        support_level="launch_ready",
        aliases=("polo shirt", "polo"),
        min_fg_ratio=0.12,
        max_fg_ratio=0.82,
        max_aspect_ratio=1.55,
        crop_padding_ratio=0.1,
        skin_ratio_threshold=0.03,
        top_skin_ratio_threshold=0.09,
    ),
    GarmentRule(
        key="blouse",
        label="Blouse",
        support_level="launch_ready",
        aliases=("blouse",),
        min_fg_ratio=0.1,
        max_fg_ratio=0.8,
        max_aspect_ratio=1.55,
        crop_padding_ratio=0.1,
        skin_ratio_threshold=0.05,
        top_skin_ratio_threshold=0.14,
    ),
    GarmentRule(
        key="top",
        label="Top",
        support_level="launch_ready",
        aliases=("crop top", "sleeveless top", "tank top", "cami", "tank", "top"),
        min_fg_ratio=0.1,
        max_fg_ratio=0.8,
        max_aspect_ratio=1.45,
        crop_padding_ratio=0.1,
        skin_ratio_threshold=0.08,
        top_skin_ratio_threshold=0.18,
    ),
    GarmentRule(
        key="short_kurti",
        label="Short Kurti",
        support_level="beta",
        aliases=("short kurti", "kurti top", "kurti"),
        min_fg_ratio=0.11,
        max_fg_ratio=0.84,
        max_aspect_ratio=1.75,
        crop_padding_ratio=0.11,
        skin_ratio_threshold=0.04,
        top_skin_ratio_threshold=0.11,
    ),
    GarmentRule(
        key="hoodie",
        label="Hoodie",
        support_level="beta",
        aliases=("zip hoodie", "hooded sweatshirt", "hoodie"),
        min_fg_ratio=0.14,
        max_fg_ratio=0.86,
        max_aspect_ratio=1.58,
        crop_padding_ratio=0.09,
        skin_ratio_threshold=0.02,
        top_skin_ratio_threshold=0.05,
    ),
    GarmentRule(
        key="sweatshirt",
        label="Sweatshirt",
        support_level="beta",
        aliases=("crewneck sweatshirt", "sweat shirt", "sweatshirt"),
        min_fg_ratio=0.13,
        max_fg_ratio=0.85,
        max_aspect_ratio=1.55,
        crop_padding_ratio=0.1,
        skin_ratio_threshold=0.02,
        top_skin_ratio_threshold=0.05,
    ),
    GarmentRule(
        key="outerwear",
        label="Outerwear",
        support_level="unsupported",
        aliases=("blazer", "jacket", "coat", "cardigan", "outerwear", "overshirt"),
    ),
    GarmentRule(
        key="long_kurta",
        label="Long Kurta",
        support_level="unsupported",
        aliases=("anarkali", "kurta dress", "long kurta"),
    ),
    GarmentRule(
        key="generic_top",
        label="Upper-Body Garment",
        support_level="launch_ready",
        aliases=(),
        min_fg_ratio=0.1,
        max_fg_ratio=0.84,
        max_aspect_ratio=1.6,
        crop_padding_ratio=0.1,
        skin_ratio_threshold=0.04,
        top_skin_ratio_threshold=0.12,
    ),
)


def resolve_garment_rule(*hints: str | None) -> GarmentRule:
    normalized_haystack = " ".join(filter(None, (_normalize(hint) for hint in hints)))
    if normalized_haystack:
        candidates: list[tuple[int, GarmentRule]] = []
        for rule in GARMENT_RULES:
            for alias in rule.aliases:
                normalized_alias = _normalize(alias)
                if normalized_alias and normalized_alias in normalized_haystack:
                    candidates.append((len(normalized_alias), rule))
                    break
        if candidates:
            candidates.sort(key=lambda item: item[0], reverse=True)
            return candidates[0][1]

    return next(rule for rule in GARMENT_RULES if rule.key == "generic_top")


def launch_support_summary() -> dict[str, list[str]]:
    summary: dict[str, list[str]] = {
        "launch_ready": [],
        "beta": [],
        "unsupported": [],
    }
    for rule in GARMENT_RULES:
        summary.setdefault(rule.support_level, []).append(rule.label)
    return summary
