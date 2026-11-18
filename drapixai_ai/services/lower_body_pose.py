from __future__ import annotations

import hashlib
import json
import math
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable, Mapping

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class PoseLandmark:
    x: float
    y: float
    confidence: float


@dataclass(frozen=True)
class LowerBodyPose:
    person_count: int
    landmarks: Mapping[str, PoseLandmark] = field(default_factory=dict)
    backend: str = "dwpose_onnx_cpu"


@dataclass(frozen=True)
class PoseValidation:
    ok: bool
    reason: str = "OK"
    measurements: Mapping[str, float] = field(default_factory=dict)


class LowerBodyPoseUnavailable(RuntimeError):
    pass


MIN_LANDMARK_CONFIDENCE = 0.35
MIN_STANDING_KNEE_ANGLE = 145.0
REQUIRED_LANDMARKS = (
    "left_shoulder", "right_shoulder", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)
COCO_WHOLEBODY_LANDMARKS = {
    "left_shoulder": 5, "right_shoulder": 6,
    "left_wrist": 9, "right_wrist": 10,
    "left_hip": 11, "right_hip": 12,
    "left_knee": 13, "right_knee": 14,
    "left_ankle": 15, "right_ankle": 16,
    "left_big_toe": 17, "left_small_toe": 18, "left_heel": 19,
    "right_big_toe": 20, "right_small_toe": 21, "right_heel": 22,
}
DWPOSE_REVISION = "548b5df25b84d9f4aac0611dfa1c2a7a12f15571"


def _visible(point: PoseLandmark | None) -> bool:
    return (
        isinstance(point, PoseLandmark)
        and all(
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            for value in (point.x, point.y, point.confidence)
        )
        and 0.0 <= point.x <= 1.0
        and 0.0 <= point.y <= 1.0
        # RTMPose exposes peak responses, not calibrated unit probabilities.
        and point.confidence >= MIN_LANDMARK_CONFIDENCE
    )


def _knee_angle(hip: PoseLandmark, knee: PoseLandmark, ankle: PoseLandmark, aspect_ratio: float) -> float:
    upper = ((hip.x - knee.x) * aspect_ratio, hip.y - knee.y)
    lower = ((ankle.x - knee.x) * aspect_ratio, ankle.y - knee.y)
    length = math.hypot(*upper) * math.hypot(*lower)
    if length <= 1e-8:
        return 0.0
    cosine = sum(a * b for a, b in zip(upper, lower)) / length
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def validate_lower_body_pose(pose: LowerBodyPose, *, image_width: int, image_height: int) -> PoseValidation:
    if isinstance(pose.person_count, bool) or not isinstance(pose.person_count, int) or pose.person_count < 0:
        return PoseValidation(False, "INVALID_POSE_EVIDENCE")
    if pose.person_count == 0:
        return PoseValidation(False, "PERSON_NOT_FOUND")
    if pose.person_count > 1:
        return PoseValidation(False, "MULTI_PERSON_UNSUPPORTED")
    if image_width <= 0 or image_height <= 0:
        return PoseValidation(False, "INVALID_POSE_EVIDENCE")
    for name in REQUIRED_LANDMARKS:
        if not _visible(pose.landmarks.get(name)):
            if name.endswith("hip"):
                return PoseValidation(False, "WAIST_NOT_VISIBLE")
            if name.endswith("ankle"):
                return PoseValidation(False, "ANKLES_NOT_VISIBLE")
            return PoseValidation(False, "LOWER_BODY_LANDMARKS_OCCLUDED")

    for side in ("left", "right"):
        foot_points = [pose.landmarks.get(f"{side}_{part}") for part in ("big_toe", "small_toe", "heel")]
        if not any(_visible(point) for point in foot_points):
            return PoseValidation(False, "FEET_NOT_VISIBLE")

    points = pose.landmarks
    angles = {
        side: _knee_angle(points[f"{side}_hip"], points[f"{side}_knee"], points[f"{side}_ankle"], image_width / image_height)
        for side in ("left", "right")
    }
    measurements = {f"{side}_knee_angle": value for side, value in angles.items()}
    for side in ("left", "right"):
        shoulder, hip, knee, ankle = (points[f"{side}_{part}"] for part in ("shoulder", "hip", "knee", "ankle"))
        if ankle.y >= 0.98:
            return PoseValidation(False, "LOWER_BODY_CROPPED", measurements)
        if not shoulder.y + 0.08 < hip.y < knee.y < ankle.y or knee.y - hip.y < 0.08:
            return PoseValidation(False, "SITTING_POSE_UNSUPPORTED", measurements)
        if angles[side] < MIN_STANDING_KNEE_ANGLE:
            return PoseValidation(False, "BENT_LEG_POSE_UNSUPPORTED", measurements)
        if ankle.y - hip.y < 0.25:
            return PoseValidation(False, "FULL_BODY_REQUIRED", measurements)

    hip_order = points["left_hip"].x - points["right_hip"].x
    if abs(hip_order) < 0.035:
        return PoseValidation(False, "SIDE_POSE_UNSUPPORTED", measurements)
    if any(
        hip_order * (points[f"left_{part}"].x - points[f"right_{part}"].x) <= 0
        for part in ("knee", "ankle")
    ):
        return PoseValidation(False, "CROSSED_LEGS_UNSUPPORTED", measurements)
    if abs(points["left_ankle"].x - points["right_ankle"].x) < 0.025:
        return PoseValidation(False, "LEGS_OVERLAPPED", measurements)

    left = min(points[f"{side}_hip"].x for side in ("left", "right")) + 0.015
    right = max(points[f"{side}_hip"].x for side in ("left", "right")) - 0.015
    waist = min(points[f"{side}_hip"].y for side in ("left", "right")) - 0.035
    hem = max(points[f"{side}_ankle"].y for side in ("left", "right"))
    for side in ("left", "right"):
        wrist = points.get(f"{side}_wrist")
        if _visible(wrist) and left <= wrist.x <= right and waist <= wrist.y <= hem:
            return PoseValidation(False, "LOWER_BODY_OCCLUDED", measurements)
    return PoseValidation(True, measurements=measurements)


def _verify_checkpoint(root: Path, relative: str, files: dict[str, object]) -> Path:
    path = root / relative
    if path.is_symlink() or not path.is_file() or root.resolve() not in path.resolve().parents:
        raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_WEIGHTS_MISSING_OR_UNSAFE")
    record = files.get(relative)
    expected_hash = record.get("sha256") if isinstance(record, dict) else None
    if not isinstance(expected_hash, str) or len(expected_hash) != 64:
        raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_WEIGHT_HASH_REQUIRED")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_hash:
        raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_WEIGHT_HASH_MISMATCH")
    return path


class DWPoseLowerBodyEstimator:
    """Use upstream all-person detection and raw COCO keypoints, before best-person selection."""

    def __init__(self, weights_dir: Path) -> None:
        root = weights_dir.resolve()
        manifest_path = root / "model-manifest.json"
        try:
            if manifest_path.stat().st_size > 1024 * 1024:
                raise ValueError("manifest too large")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if manifest["dwpose"]["revision"] != DWPOSE_REVISION:
                raise ValueError("unexpected DWPose revision")
            paths = [
                _verify_checkpoint(root, relative, manifest["files"])
                for relative in ("dwpose/yolox_l.onnx", "dwpose/dw-ll_ucoco_384.onnx")
            ]
            import onnxruntime as ort
            from fashn_vton.dwpose.onnxdet import inference_detector
            from fashn_vton.dwpose.onnxpose import inference_pose

            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self._sessions = [
                ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
                for path in paths
            ]
            self._detect = inference_detector
            self._pose = inference_pose
            self._lock = threading.Lock()
        except LowerBodyPoseUnavailable:
            raise
        except Exception as exc:
            raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_BACKEND_UNAVAILABLE") from exc

    def __call__(self, image: Image.Image) -> LowerBodyPose:
        bounded = image.convert("RGB")
        bounded.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
        bgr = np.ascontiguousarray(np.asarray(bounded)[:, :, ::-1])
        with self._lock:
            boxes = np.asarray(self._detect(self._sessions[0], bgr))
            if boxes.size == 0:
                return LowerBodyPose(0)
            if boxes.ndim != 2 or boxes.shape[1] != 4 or not np.isfinite(boxes).all():
                raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_OUTPUT_INVALID")
            if len(boxes) != 1:
                return LowerBodyPose(int(len(boxes)))
            keypoints, scores = self._pose(self._sessions[1], boxes, bgr)
        keypoints, scores = np.asarray(keypoints), np.asarray(scores)
        if keypoints.ndim != 3 or keypoints.shape[0] != 1 or keypoints.shape[1] < 23 or keypoints.shape[2] != 2:
            raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_OUTPUT_INVALID")
        if scores.shape != keypoints.shape[:2]:
            raise LowerBodyPoseUnavailable("LOWER_BODY_POSE_OUTPUT_INVALID")
        landmarks = {
            name: PoseLandmark(
                float(keypoints[0, index, 0]) / bounded.width,
                float(keypoints[0, index, 1]) / bounded.height,
                float(scores[0, index]),
            )
            for name, index in COCO_WHOLEBODY_LANDMARKS.items()
        }
        return LowerBodyPose(1, landmarks)


_ESTIMATOR_INIT_LOCK = threading.Lock()


@lru_cache(maxsize=1)
def _cached_pose_estimator(weights_dir: str) -> Callable[[Image.Image], LowerBodyPose]:
    return DWPoseLowerBodyEstimator(Path(weights_dir))


def get_lower_body_pose_estimator(weights_dir: str) -> Callable[[Image.Image], LowerBodyPose]:
    with _ESTIMATOR_INIT_LOCK:
        return _cached_pose_estimator(weights_dir)
