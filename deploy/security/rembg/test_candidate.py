#!/usr/bin/env python3
"""Run the wheel's actual SAM download method with recording-only transport.

No ONNX graph is loaded, model is downloaded or network service is attacked.
"""
from __future__ import annotations

import argparse
import ast
import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import types
import tempfile
import unittest
import zipfile

import build_candidate as builder

WHEEL = None


def method(source: bytes):
    tree = ast.parse(source)
    klass = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "SamSession")
    download = next(n for n in klass.body if isinstance(n, ast.FunctionDef) and n.name == "download_models")
    isolated = ast.Module(body=[ast.ClassDef(name="RecordingSession", bases=[], keywords=[],
                                           body=[download], decorator_list=[])], type_ignores=[])
    ast.fix_missing_locations(isolated)
    calls = []
    scope = {"os": types.SimpleNamespace(path=types.SimpleNamespace(join=os.path.join, exists=lambda p: True)),
             "pooch": types.SimpleNamespace(retrieve=lambda *args, **kwargs: calls.append((args, kwargs)))}
    exec(compile(isolated, "hash-verified-wheel-sam-download", "exec"), scope)
    session = scope["RecordingSession"]
    session.u2net_home = lambda *a, **kw: "/synthetic-model-cache"
    return session.download_models, calls


class SamBackportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if builder.digest(WHEEL.read_bytes()) != builder.WHEEL_SHA256:
            raise ValueError("UPSTREAM_WHEEL_HASH_MISMATCH")
        with zipfile.ZipFile(WHEEL) as archive:
            cls.original = archive.read(builder.MODULE)
        cls.patched = builder.patch(cls.original)

    def test_negative_control_reaches_unsafe_upstream_filename_and_url(self):
        download, calls = method(self.original)
        payload = "../synthetic#injection"
        download(sam_model=payload)
        self.assertEqual(len(calls), 2)
        self.assertIn(payload, calls[0][0][0])
        self.assertIn(payload, calls[0][1]["fname"])

    def test_malicious_or_unexpected_names_fail_before_any_transport(self):
        download, calls = method(self.patched)
        for payload in ["../synthetic#injection", "/absolute", "C:\\outside", "..\\outside",
                        "sam_vit_b_01ec64#fragment", "sam_vit_b_01ec64/child", "", None, 42, [], {}]:
            with self.subTest(payload=payload), self.assertRaisesRegex(ValueError, "UNSUPPORTED_SAM_MODEL"):
                download(sam_model=payload)
        self.assertEqual(calls, [])

    def test_supported_and_default_download_semantics_unchanged(self):
        for name in [None, "sam_vit_b_01ec64", "sam_vit_l_0b3195", "sam_vit_h_4b8939"]:
            for quant in [False, True]:
                options = {"sam_quant": quant}
                if name is not None:
                    options["sam_model"] = name
                before, before_calls = method(self.original)
                after, after_calls = method(self.patched)
                with self.subTest(name=name, quant=quant):
                    self.assertEqual(before(**options), after(**options))
                    self.assertEqual(before_calls, after_calls)

    def test_only_allowlist_guard_added_to_model_source(self):
        self.assertEqual(self.patched.replace(builder.GUARD.encode(), b"", 1), self.original)
        with self.assertRaisesRegex(ValueError, "UPSTREAM_SAM_HASH_MISMATCH"):
            builder.patch(self.original + b"\n")

    def test_reproducible_wheel_and_all_unmodified_members_and_record(self):
        allowed = (Path(__file__).resolve().parents[3] / "runtime/security-candidate/rembg").resolve()
        allowed.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="wheel-test-", dir=allowed)
        root = Path(temporary.name).resolve()
        self.assertTrue(root.is_relative_to(allowed))
        self.addCleanup(temporary.cleanup)
        first = builder.build(WHEEL, root / "test-1")
        second = builder.build(WHEEL, root / "test-2")
        self.assertEqual(first, second)
        filename = f"rembg-{builder.VERSION}-{builder.BUILD}-py3-none-any.whl"
        raw = (root / "test-1" / filename).read_bytes()
        self.assertEqual(raw, (root / "test-2" / filename).read_bytes())
        with zipfile.ZipFile(WHEEL) as original, zipfile.ZipFile(io.BytesIO(raw)) as candidate:
            modified = {builder.MODULE, f"{builder.DIST}/WHEEL", f"{builder.DIST}/RECORD"}
            self.assertEqual(set(candidate.namelist()) - set(original.namelist()),
                             {f"{builder.DIST}/DRAPIXAI_PATCH.json"})
            for name in original.namelist():
                if name not in modified:
                    self.assertEqual(candidate.read(name), original.read(name), name)
            for name, digest, size in csv.reader(io.StringIO(candidate.read(f"{builder.DIST}/RECORD").decode())):
                if not digest:
                    self.assertEqual(name, f"{builder.DIST}/RECORD")
                    continue
                data = candidate.read(name)
                actual = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
                self.assertEqual(digest, "sha256=" + actual)
                self.assertEqual(int(size), len(data))
            metadata = candidate.read(f"{builder.DIST}/METADATA")
            self.assertIn(b"Version: 2.0.69\n", metadata)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", required=True, type=Path)
    args, remaining = parser.parse_known_args()
    WHEEL = args.wheel
    unittest.main(argv=[__file__, *remaining])
