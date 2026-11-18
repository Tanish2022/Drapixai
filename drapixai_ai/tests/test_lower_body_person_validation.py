from __future__ import annotations

import hashlib
import json
import tempfile
import types
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from drapixai_ai.services.lower_body_pose import (
    COCO_WHOLEBODY_LANDMARKS,
    DWPOSE_REVISION,
    DWPoseLowerBodyEstimator,
    LowerBodyPose,
    LowerBodyPoseUnavailable,
    PoseLandmark,
    validate_lower_body_pose,
)
from drapixai_ai.services.lower_body_validator import validate_lower_body_person


def _standing_pose() -> LowerBodyPose:
    landmarks = {}
    for side, x in (("left", 0.43), ("right", 0.57)):
        for part, y in (("shoulder", 0.24), ("hip", 0.47), ("knee", 0.68), ("ankle", 0.90)):
            landmarks[f"{side}_{part}"] = PoseLandmark(x, y, 0.95)
        landmarks[f"{side}_heel"] = PoseLandmark(x, 0.94, 0.95)
        landmarks[f"{side}_wrist"] = PoseLandmark(0.30 if side == "left" else 0.70, 0.50, 0.95)
    return LowerBodyPose(1, landmarks)


def _changed_pose(**changes: tuple[float, float, float]) -> LowerBodyPose:
    pose = _standing_pose()
    return replace(pose, landmarks={
        **pose.landmarks,
        **{name: PoseLandmark(*values) for name, values in changes.items()},
    })


def _framing_fixture() -> Image.Image:
    # High-detail unit fixture verifies plumbing, never photographic accuracy.
    y, x = np.indices((768, 512))
    gray = (((x // 16 + y // 16) % 2) * 100 + 130).astype(np.uint8)
    gray[-32:] = 230
    return Image.fromarray(gray).convert("RGB")


class LowerBodyPoseRuleTests(unittest.TestCase):
    def _validate(self, pose: LowerBodyPose):
        return validate_lower_body_pose(pose, image_width=640, image_height=1000)

    def test_standing_and_mirrored_standing_are_accepted(self) -> None:
        self.assertTrue(self._validate(_standing_pose()).ok)
        pose = _standing_pose()
        mirrored = replace(pose, landmarks={name: replace(point, x=1 - point.x) for name, point in pose.landmarks.items()})
        self.assertTrue(self._validate(mirrored).ok)
        self.assertTrue(self._validate(_changed_pose(left_hip=(0.43, 0.47, 1.1))).ok)

    def test_zero_and_multiple_people_are_rejected(self) -> None:
        self.assertEqual(self._validate(LowerBodyPose(0)).reason, "PERSON_NOT_FOUND")
        self.assertEqual(self._validate(LowerBodyPose(2)).reason, "MULTI_PERSON_UNSUPPORTED")
        self.assertEqual(self._validate(LowerBodyPose(True)).reason, "INVALID_POSE_EVIDENCE")

    def test_required_landmarks_must_be_visible_finite_and_in_frame(self) -> None:
        for confidence in (0.0, 0.34, float("nan"), float("inf"), True):
            with self.subTest(confidence=confidence):
                self.assertFalse(self._validate(_changed_pose(left_hip=(0.43, 0.47, confidence))).ok)
        self.assertEqual(self._validate(_changed_pose(left_hip=(-0.1, 0.47, 0.95))).reason, "WAIST_NOT_VISIBLE")
        self.assertEqual(self._validate(_changed_pose(left_ankle=(0.43, 0.9, 0.1))).reason, "ANKLES_NOT_VISIBLE")
        self.assertEqual(self._validate(_changed_pose(left_knee=(float("nan"), 0.68, 0.95))).reason, "LOWER_BODY_LANDMARKS_OCCLUDED")

    def test_visible_ankles_do_not_substitute_for_missing_feet(self) -> None:
        pose = _standing_pose()
        landmarks = dict(pose.landmarks)
        del landmarks["left_heel"]
        self.assertEqual(self._validate(replace(pose, landmarks=landmarks)).reason, "FEET_NOT_VISIBLE")

    def test_seated_bent_crossed_side_and_overlapping_poses_are_rejected(self) -> None:
        cases = (
            (_changed_pose(left_knee=(0.62, 0.49, 0.95)), "SITTING_POSE_UNSUPPORTED"),
            (_changed_pose(left_knee=(0.55, 0.68, 0.95)), "BENT_LEG_POSE_UNSUPPORTED"),
            (_changed_pose(left_knee=(0.49, 0.68, 0.95), right_knee=(0.51, 0.68, 0.95),
                           left_ankle=(0.57, 0.9, 0.95), right_ankle=(0.43, 0.9, 0.95)), "CROSSED_LEGS_UNSUPPORTED"),
            (_changed_pose(left_hip=(0.49, 0.47, 0.95), right_hip=(0.51, 0.47, 0.95)), "SIDE_POSE_UNSUPPORTED"),
            (_changed_pose(left_ankle=(0.49, 0.9, 0.95), right_ankle=(0.51, 0.9, 0.95)), "LEGS_OVERLAPPED"),
        )
        for pose, reason in cases:
            with self.subTest(reason=reason):
                self.assertEqual(self._validate(pose).reason, reason)

    def test_clipping_and_hands_over_lower_body_are_rejected(self) -> None:
        self.assertEqual(self._validate(_changed_pose(left_ankle=(0.43, 0.99, 0.95))).reason, "LOWER_BODY_CROPPED")
        self.assertEqual(self._validate(_changed_pose(left_wrist=(0.5, 0.55, 0.95))).reason, "LOWER_BODY_OCCLUDED")


class LowerBodyPersonValidationTests(unittest.TestCase):
    def test_strict_validation_records_pose_evidence(self) -> None:
        result = validate_lower_body_person(_framing_fixture(), pose_estimator=lambda _image: _standing_pose())
        self.assertTrue(result.ok)
        self.assertTrue(result.pose_checked)
        self.assertEqual(result.person_count, 1)
        self.assertGreaterEqual(result.pose_measurements["left_knee_angle"], 145)

    def test_missing_backend_or_detector_error_never_falls_back(self) -> None:
        estimator = Mock(side_effect=LowerBodyPoseUnavailable("unit test"))
        result = validate_lower_body_person(_framing_fixture(), pose_estimator=estimator)
        self.assertFalse(result.ok)
        self.assertFalse(result.pose_checked)
        self.assertEqual(result.reason, "LOWER_BODY_POSE_UNAVAILABLE")

    def test_scaffold_mode_is_explicit_and_marked_unverified(self) -> None:
        with patch("drapixai_ai.services.lower_body_validator.get_lower_body_pose_estimator") as factory:
            result = validate_lower_body_person(_framing_fixture(), require_pose=False)
        factory.assert_not_called()
        self.assertTrue(result.ok)
        self.assertFalse(result.pose_checked)
        self.assertIn("LOWER_BODY_POSE_NOT_CHECKED", result.warnings)

    def test_small_and_invalid_inputs_reject_before_loading_pose(self) -> None:
        estimator = Mock()
        self.assertFalse(validate_lower_body_person(b"invalid image", pose_estimator=estimator).ok)
        result = validate_lower_body_person(Image.new("RGB", (100, 200)), pose_estimator=estimator)
        self.assertEqual(result.reason, "PERSON_IMAGE_TOO_SMALL")
        estimator.assert_not_called()


class DWPoseAdapterTests(unittest.TestCase):
    def _adapter(self, root: Path, detector: Mock, pose_inference: Mock) -> DWPoseLowerBodyEstimator:
        paths = ("dwpose/yolox_l.onnx", "dwpose/dw-ll_ucoco_384.onnx")
        files = {}
        for relative in paths:
            path = root / relative
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(b"unit-only fake ONNX; no real model loaded")
            files[relative] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        (root / "model-manifest.json").write_text(json.dumps({
            "dwpose": {"revision": DWPOSE_REVISION}, "files": files,
        }), encoding="utf-8")
        ort = types.ModuleType("onnxruntime")
        ort.SessionOptions = lambda: types.SimpleNamespace()
        ort.InferenceSession = Mock(return_value=object())
        det_module = types.ModuleType("fashn_vton.dwpose.onnxdet")
        det_module.inference_detector = detector
        pose_module = types.ModuleType("fashn_vton.dwpose.onnxpose")
        pose_module.inference_pose = pose_inference
        with patch.dict("sys.modules", {
            "onnxruntime": ort,
            "fashn_vton.dwpose.onnxdet": det_module,
            "fashn_vton.dwpose.onnxpose": pose_module,
        }):
            adapter = DWPoseLowerBodyEstimator(root)
        for call in ort.InferenceSession.call_args_list:
            self.assertEqual(call.kwargs["providers"], ["CPUExecutionProvider"])
        return adapter

    def test_no_detection_never_uses_upstream_full_image_pose_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pose_inference = Mock()
            adapter = self._adapter(Path(directory), Mock(return_value=np.empty((0, 4))), pose_inference)
            self.assertEqual(adapter(Image.new("RGB", (640, 1000))).person_count, 0)
            pose_inference.assert_not_called()

    def test_all_detections_are_counted_before_best_person_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            pose_inference = Mock()
            adapter = self._adapter(Path(directory), Mock(return_value=np.array([[0, 0, 200, 900], [300, 0, 600, 900]])), pose_inference)
            self.assertEqual(adapter(Image.new("RGB", (640, 1000))).person_count, 2)
            pose_inference.assert_not_called()

    def test_raw_coco_mapping_color_order_and_normalization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            points = np.zeros((1, 23, 2))
            scores = np.ones((1, 23)) * 0.95
            for name, index in COCO_WHOLEBODY_LANDMARKS.items():
                point = _standing_pose().landmarks.get(name, PoseLandmark(0.43, 0.94, 0.95))
                points[0, index] = point.x * 640, point.y * 1000
            detector = Mock(return_value=np.array([[100, 100, 600, 960]]))
            adapter = self._adapter(Path(directory), detector, Mock(return_value=(points, scores)))
            pose = adapter(Image.new("RGB", (640, 1000), (10, 20, 30)))
            self.assertAlmostEqual(pose.landmarks["left_hip"].x, 0.43)
            self.assertAlmostEqual(pose.landmarks["left_ankle"].y, 0.9)
            np.testing.assert_array_equal(detector.call_args.args[1][0, 0], [30, 20, 10])

    def test_unverified_checkpoints_never_initialize_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(LowerBodyPoseUnavailable):
                DWPoseLowerBodyEstimator(Path(directory))

    def test_tampered_checkpoint_fails_hash_verification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._adapter(root, Mock(), Mock())
            (root / "dwpose/yolox_l.onnx").write_bytes(b"tampered")
            with self.assertRaisesRegex(LowerBodyPoseUnavailable, "HASH_MISMATCH"):
                DWPoseLowerBodyEstimator(root)

    def test_malformed_model_outputs_fail_instead_of_selecting_a_person(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            adapter = self._adapter(
                Path(directory), Mock(return_value=np.array([[0, 0, 600, 900]])),
                Mock(return_value=(np.zeros((1, 17, 2)), np.ones((1, 17)))),
            )
            with self.assertRaisesRegex(LowerBodyPoseUnavailable, "OUTPUT_INVALID"):
                adapter(Image.new("RGB", (640, 1000)))
