from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import traceback
from dataclasses import asdict, dataclass
from pathlib import Path

from PIL import Image

from drapixai_ai.configs.settings import settings
from drapixai_ai.pipeline.tryon_pipeline import DrapixAITryOnPipeline
from drapixai_ai.preprocess.person_validator import validate_person_image
from drapixai_ai.services.garment_preprocessor import (
    GarmentPreprocessOptions,
    preprocess_garment,
)


APP_ROOT = Path(os.getenv("DRAPIXAI_APP_ROOT", Path.cwd())).resolve()
MATRIX_FILE = Path(
    os.getenv(
        "DRAPIXAI_UPPER_BODY_50_MANIFEST",
        APP_ROOT / "runtime" / "test_assets" / "upper_body_50_manifest.json",
    )
).resolve()
OUTPUT_ROOT = Path(
    os.getenv(
        "DRAPIXAI_UPPER_BODY_50_DIR",
        APP_ROOT / "runtime" / "upper_body_50_matrix",
    )
).resolve()
MIN_QUALITY_SCORE = float(os.getenv("DRAPIXAI_MATRIX_MIN_QUALITY_SCORE", "0.95"))
TARGET_LATENCY_MS = int(os.getenv("DRAPIXAI_MATRIX_TARGET_LATENCY_MS", "12000"))

EXPECTED_SEGMENTS = {
    "shirt": 8,
    "tshirt": 8,
    "polo": 6,
    "hoodie_sweatshirt": 6,
    "blouse_top": 6,
    "short_kurti": 6,
    "sleeveless_top": 4,
    "edge_case": 6,
}
REQUIRED_GENDERS = {"men", "women"}
REQUIRED_BODY_PROFILES = {"slim", "average", "broad"}
REQUIRED_POSE_PROFILES = {"front_straight_arms", "front_slight_bend", "front_relaxed"}
SAFE_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{2,79}$")


@dataclass(frozen=True)
class MatrixCase:
    index: int
    slug: str
    segment: str
    person_path: Path
    garment_path: Path
    gender: str
    body_profile: str
    pose_profile: str
    garment_label: str
    garment_profile: str | None
    notes: str
    rights_approved: bool


@dataclass(frozen=True)
class PreparedCase:
    case: MatrixCase
    person_hash: str
    garment_hash: str
    processed_garment_path: Path
    preprocess_metadata: dict[str, object]


def _resolve_asset_path(value: object) -> Path:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("ASSET_PATH_REQUIRED")
    if raw.lower().startswith(("http://", "https://")):
        raise ValueError("REMOTE_ASSET_URL_NOT_ALLOWED")
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (APP_ROOT / path).resolve()


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _rgb_on_white(image: Image.Image) -> Image.Image:
    if image.mode not in ("RGBA", "LA"):
        return image.convert("RGB")
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    return Image.alpha_composite(background, rgba).convert("RGB")


def _save_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _git_metadata() -> dict[str, object]:
    def run(*args: str) -> str | None:
        completed = subprocess.run(
            ["git", "-C", str(APP_ROOT), *args],
            capture_output=True,
            check=False,
            text=True,
        )
        return completed.stdout.strip() if completed.returncode == 0 else None

    return {
        "commit": run("rev-parse", "HEAD"),
        "branch": run("branch", "--show-current"),
        "dirty": bool(run("status", "--porcelain")),
    }


def _load_manifest() -> tuple[list[MatrixCase], dict[str, object]]:
    if not MATRIX_FILE.exists():
        raise FileNotFoundError(
            f"Missing strict matrix manifest: {MATRIX_FILE}. "
            "Use 50 local, rights-approved person/garment pairs; remote product URLs are not accepted."
        )
    payload = json.loads(MATRIX_FILE.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("cases"), list):
        raise ValueError("MATRIX_MANIFEST_INVALID")
    if payload.get("rights_confirmed") is not True:
        raise ValueError("MATRIX_RIGHTS_NOT_CONFIRMED")
    rights_scope = str(payload.get("rights_scope") or "").strip().lower()
    if rights_scope not in {"internal_qa", "public_catalog"}:
        raise ValueError("MATRIX_RIGHTS_SCOPE_INVALID")

    cases: list[MatrixCase] = []
    for index, raw in enumerate(payload["cases"], start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"MATRIX_CASE_INVALID:{index}")
        slug = str(raw.get("slug") or "").strip().lower()
        if not SAFE_SLUG.fullmatch(slug):
            raise ValueError(f"MATRIX_SLUG_INVALID:{index}:{slug}")
        cases.append(
            MatrixCase(
                index=index,
                slug=slug,
                segment=str(raw.get("segment") or "").strip().lower(),
                person_path=_resolve_asset_path(raw.get("person_path")),
                garment_path=_resolve_asset_path(raw.get("garment_path")),
                gender=str(raw.get("gender") or "").strip().lower(),
                body_profile=str(raw.get("body_profile") or "").strip().lower(),
                pose_profile=str(raw.get("pose_profile") or "").strip().lower(),
                garment_label=str(raw.get("garment_label") or "").strip(),
                garment_profile=(str(raw.get("garment_profile") or "").strip().lower() or None),
                notes=str(raw.get("notes") or "").strip(),
                rights_approved=raw.get("rights_approved") is True,
            )
        )

    if len(cases) != 50:
        raise ValueError(f"MATRIX_REQUIRES_EXACTLY_50_CASES:{len(cases)}")
    if len({case.slug for case in cases}) != len(cases):
        raise ValueError("MATRIX_SLUGS_MUST_BE_UNIQUE")

    segment_counts = {
        segment: sum(case.segment == segment for case in cases)
        for segment in EXPECTED_SEGMENTS
    }
    unknown_segments = sorted({case.segment for case in cases} - set(EXPECTED_SEGMENTS))
    if segment_counts != EXPECTED_SEGMENTS or unknown_segments:
        raise ValueError(
            f"MATRIX_SEGMENT_COUNTS_INVALID:expected={EXPECTED_SEGMENTS}:actual={segment_counts}:unknown={unknown_segments}"
        )
    if {case.gender for case in cases} != REQUIRED_GENDERS:
        raise ValueError("MATRIX_GENDER_COVERAGE_INVALID")
    if not REQUIRED_BODY_PROFILES.issubset({case.body_profile for case in cases}):
        raise ValueError("MATRIX_BODY_PROFILE_COVERAGE_INVALID")
    if not REQUIRED_POSE_PROFILES.issubset({case.pose_profile for case in cases}):
        raise ValueError("MATRIX_POSE_PROFILE_COVERAGE_INVALID")
    if any(not case.rights_approved for case in cases):
        raise ValueError("MATRIX_CASE_RIGHTS_NOT_APPROVED")

    return cases, {
        "rights_scope": rights_scope,
        "rights_reference": str(payload.get("rights_reference") or "").strip(),
        "segment_counts": segment_counts,
    }


def _preflight(cases: list[MatrixCase], manifest_metadata: dict[str, object]) -> list[PreparedCase]:
    preflight_root = OUTPUT_ROOT / "preflight"
    preflight_root.mkdir(parents=True, exist_ok=True)
    prepared: list[PreparedCase] = []
    failures: list[dict[str, object]] = []
    seen_garments: dict[str, str] = {}
    person_hashes: set[str] = set()

    for case in cases:
        try:
            if not case.person_path.is_file():
                raise FileNotFoundError(f"PERSON_FILE_MISSING:{case.person_path}")
            if not case.garment_path.is_file():
                raise FileNotFoundError(f"GARMENT_FILE_MISSING:{case.garment_path}")

            person_bytes = case.person_path.read_bytes()
            garment_bytes = case.garment_path.read_bytes()
            person_hash = _sha256(person_bytes)
            garment_hash = _sha256(garment_bytes)
            duplicate_slug = seen_garments.get(garment_hash)
            if duplicate_slug:
                raise ValueError(f"DUPLICATE_GARMENT_SOURCE:{duplicate_slug}")
            seen_garments[garment_hash] = case.slug
            person_hashes.add(person_hash)

            with Image.open(case.person_path) as source:
                person = source.convert("RGB")
            person_validation = validate_person_image(person)
            if not person_validation.ok:
                raise ValueError(f"PERSON_VALIDATION_FAILED:{','.join(person_validation.warnings)}")

            preprocess = preprocess_garment(
                garment_bytes,
                options=GarmentPreprocessOptions(
                    garment_profile=case.garment_profile,
                    category_hint=case.segment,
                    product_name=case.garment_label,
                    garment_id=case.slug,
                    garment_type="upper",
                ),
            )
            if preprocess.warnings:
                raise ValueError(f"GARMENT_PREPROCESS_WARNINGS:{','.join(preprocess.warnings)}")
            processed_path = preflight_root / f"{case.index:02d}_{case.slug}_garment.png"
            preprocess.image.save(processed_path, format="PNG")
            preprocess_metadata = {
                "mode": "strict",
                "profile_key": preprocess.profile_key,
                "profile_label": preprocess.profile_label,
                "support_level": preprocess.support_level,
                "did_process": preprocess.did_process,
                "reason": preprocess.reason,
                "warnings": list(preprocess.warnings),
            }
            prepared.append(
                PreparedCase(
                    case=case,
                    person_hash=person_hash,
                    garment_hash=garment_hash,
                    processed_garment_path=processed_path,
                    preprocess_metadata=preprocess_metadata,
                )
            )
        except Exception as exc:  # noqa: BLE001
            failures.append({"slug": case.slug, "error": str(exc)})

    if len(person_hashes) < 8:
        failures.append({"error": f"MATRIX_REQUIRES_AT_LEAST_8_UNIQUE_PEOPLE:{len(person_hashes)}"})
    report = {
        "manifest": str(MATRIX_FILE),
        "manifest_metadata": manifest_metadata,
        "defined_cases": len(cases),
        "prepared_cases": len(prepared),
        "unique_person_sources": len(person_hashes),
        "unique_garment_sources": len(seen_garments),
        "failures": failures,
    }
    _save_json(OUTPUT_ROOT / "preflight.json", report)
    if failures or len(prepared) != 50:
        raise RuntimeError(
            f"STRICT_MATRIX_PREFLIGHT_FAILED:{len(failures)}; see {OUTPUT_ROOT / 'preflight.json'}"
        )
    return prepared


def _result_gate_failures(result: object, latency_ms: int) -> list[str]:
    failures: list[str] = []
    quality_score = float(getattr(result, "quality_score", 0.0) or 0.0)
    warnings = list(getattr(result, "warnings", []) or [])
    if quality_score < MIN_QUALITY_SCORE:
        failures.append(f"QUALITY_BELOW_{MIN_QUALITY_SCORE:.2f}:{quality_score:.6f}")
    if getattr(result, "candidate_count", None) != 1:
        failures.append(f"CANDIDATE_COUNT_NOT_ONE:{getattr(result, 'candidate_count', None)}")
    if warnings:
        failures.append(f"WARNINGS_PRESENT:{','.join(warnings)}")
    if latency_ms > TARGET_LATENCY_MS:
        failures.append(f"LATENCY_ABOVE_{TARGET_LATENCY_MS}:{latency_ms}")
    if str(getattr(result, "engine", "")).lower() != "catvton":
        failures.append(f"ENGINE_NOT_CATVTON:{getattr(result, 'engine', None)}")
    return failures


def main() -> int:
    if settings.tryon_engine.lower() != "catvton":
        raise RuntimeError(f"STRICT_MATRIX_REQUIRES_CATVTON:{settings.tryon_engine}")
    if not 0.0 <= MIN_QUALITY_SCORE <= 1.0:
        raise ValueError("DRAPIXAI_MATRIX_MIN_QUALITY_SCORE must be between 0 and 1")
    if TARGET_LATENCY_MS <= 0:
        raise ValueError("DRAPIXAI_MATRIX_TARGET_LATENCY_MS must be positive")

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    cases, manifest_metadata = _load_manifest()
    prepared = _preflight(cases, manifest_metadata)

    start = int(os.getenv("DRAPIXAI_MATRIX_START", "0") or "0")
    limit = int(os.getenv("DRAPIXAI_MATRIX_LIMIT", "0") or "0")
    selected = prepared[start:]
    if limit > 0:
        selected = selected[:limit]
    if not selected:
        raise ValueError("MATRIX_SELECTION_EMPTY")

    pipeline = DrapixAITryOnPipeline()
    summary: list[dict[str, object]] = []
    for prepared_case in selected:
        case = prepared_case.case
        case_dir = OUTPUT_ROOT / f"{case.index:02d}_{case.slug}"
        case_dir.mkdir(parents=True, exist_ok=True)
        entry: dict[str, object] = {
            "case": {**asdict(case), "person_path": str(case.person_path), "garment_path": str(case.garment_path)},
            "person_sha256": prepared_case.person_hash,
            "garment_sha256": prepared_case.garment_hash,
            "preprocess": prepared_case.preprocess_metadata,
            "status": "pending",
            "quality_mode": "standard",
        }
        try:
            with Image.open(case.person_path) as source:
                person = source.convert("RGB")
            with Image.open(prepared_case.processed_garment_path) as source:
                garment = _rgb_on_white(source)
            person.save(case_dir / "person.png", format="PNG")
            garment.save(case_dir / "garment.png", format="PNG")

            started_at = time.perf_counter()
            result = pipeline.run_tryon_with_metadata(
                person,
                garment,
                inference_steps=settings.inference_steps,
                guidance_scale=settings.guidance_scale,
                garment_type="upper",
                quality="standard",
            )
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            result.image.save(case_dir / "result.png", format="PNG")
            gate_failures = _result_gate_failures(result, latency_ms)
            entry.update(
                {
                    "status": "rejected" if gate_failures else "passed",
                    "latency_ms": latency_ms,
                    "gate_failures": gate_failures,
                    "result_metadata": {
                        "engine": result.engine,
                        "quality_score": result.quality_score,
                        "candidate_count": result.candidate_count,
                        "candidate_scores": result.candidate_scores,
                        "warnings": result.warnings,
                        "metadata": result.metadata,
                    },
                }
            )
        except Exception as exc:  # noqa: BLE001
            entry.update(
                {
                    "status": "generation_failed",
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )
        summary.append(entry)
        _save_json(case_dir / "summary.json", entry)
        print(f"{case.slug}: {entry['status']}")

    statuses = {name: sum(item["status"] == name for item in summary) for name in ("passed", "rejected", "generation_failed")}
    quality_scores = [
        float(item["result_metadata"]["quality_score"])
        for item in summary
        if isinstance(item.get("result_metadata"), dict)
    ]
    report = {
        "matrix_file": str(MATRIX_FILE),
        "output_root": str(OUTPUT_ROOT),
        "git": _git_metadata(),
        "manifest_metadata": manifest_metadata,
        "total_defined_cases": len(cases),
        "selected_cases": len(selected),
        "full_matrix_run": len(selected) == 50,
        "quality_mode": "standard",
        "gates": {
            "engine": "catvton",
            "candidate_count": 1,
            "min_quality_score": MIN_QUALITY_SCORE,
            "target_latency_ms": TARGET_LATENCY_MS,
            "warnings_allowed": 0,
        },
        "statuses": statuses,
        "average_quality_score": sum(quality_scores) / len(quality_scores) if quality_scores else None,
        "cases": summary,
    }
    _save_json(OUTPUT_ROOT / "summary.json", report)
    catalog_command = [
        sys.executable,
        str(APP_ROOT / "deploy" / "runpod" / "build_upper_body_50_catalog.py"),
        "--summary",
        str(OUTPUT_ROOT / "summary.json"),
    ]
    catalog = subprocess.run(catalog_command, capture_output=True, text=True, check=False)
    report["catalog"] = {
        "status": "created" if catalog.returncode == 0 else "failed",
        "stdout": catalog.stdout.strip(),
        "stderr": catalog.stderr.strip(),
    }
    _save_json(OUTPUT_ROOT / "summary.json", report)
    print(OUTPUT_ROOT / "summary.json")
    return 0 if statuses["passed"] == len(selected) and catalog.returncode == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
