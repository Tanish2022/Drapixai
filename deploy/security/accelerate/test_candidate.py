#!/usr/bin/env python3
"""CPU-only guard and exact-wheel regression tests; no model deserialization."""
from __future__ import annotations

import argparse
import ast
import base64
import copy
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


builder = module("candidate_builder", "build_candidate.py")
guard = module("shard_guard", "shard_guard.py")
WHEEL = None


class ShardGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="drapixai-shard-guard-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "model"
        self.root.mkdir()
        (self.root / "part.bin").write_bytes(b"synthetic bytes; never deserialize")

    def test_valid_paths_preserve_sort_dedup_and_spelling(self):
        (self.root / "nested").mkdir()
        (self.root / "nested/part.bin").write_bytes(b"synthetic")
        values = {"b": "nested/part.bin", "a": "./part.bin", "c": "./part.bin"}
        before = (self.root / "part.bin").read_bytes()
        expected = [os.path.join(str(self.root), p) for p in sorted(set(values.values()))]
        self.assertEqual(guard._drapixai_checkpoint_files(str(self.root), values), expected)
        self.assertEqual((self.root / "part.bin").read_bytes(), before)

    def test_invalid_maps_and_escape_names(self):
        for mapping in [None, [], {}, {"a": None}, {"a": 1}, {"a": ""}, {"": "part.bin"}]:
            with self.subTest(mapping=mapping), self.assertRaisesRegex(ValueError, "MAP_INVALID"):
                guard._drapixai_checkpoint_files(str(self.root), mapping)
        for name in ["../part.bin", "nested/../../outside", "/tmp/outside", "C:/outside",
                     "C:outside", "\\\\server\\share", "nested\\part.bin", "part\x00.bin"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "ESCAPE"):
                guard._drapixai_checkpoint_files(str(self.root), {"a": name})

    def test_missing_directory_and_root_shards(self):
        for name, error in [("missing", FileNotFoundError), (".", ValueError)]:
            with self.subTest(name=name), self.assertRaises(error):
                guard._drapixai_checkpoint_files(str(self.root), {"a": name})

    @unittest.skipIf(os.name == "nt", "Linux CI verifies real symlink and FIFO semantics")
    def test_links_fifo_socket_and_directory_rejected_before_open(self):
        outside = self.root.parent / "outside.bin"
        outside.write_bytes(b"synthetic")
        (self.root / "link.bin").symlink_to(outside)
        (self.root / "directory-link").symlink_to(self.root.parent, target_is_directory=True)
        (self.root / "directory").mkdir()
        os.mkfifo(self.root / "fifo.bin")
        with socket.socket(socket.AF_UNIX) as sock:
            sock.bind(str(self.root / "socket.bin"))
            for name in ["link.bin", "directory-link/outside.bin", "directory", "fifo.bin", "socket.bin"]:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    guard._drapixai_checkpoint_files(str(self.root), {"a": name})
        root_link = self.root.parent / "model-link"
        root_link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "LINK_REJECTED"):
            guard._drapixai_checkpoint_files(str(root_link), {"a": "part.bin"})


class ExactWheelTests(unittest.TestCase):
    def setUp(self):
        parent = HERE.parents[2] / "runtime/security-candidate/accelerate-tests"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="wheel-", dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_offline_build_reproducibility_records_and_unchanged_tensor_code(self):
        first = builder.build(WHEEL, self.root / "one")
        second = builder.build(WHEEL, self.root / "two")
        self.assertEqual(first["candidate_wheel_sha256"], second["candidate_wheel_sha256"])
        self.assertEqual(first["status"], "REVIEW_CANDIDATE_NOT_APPROVED")
        candidate = next((self.root / "one").glob("*.whl"))
        with zipfile.ZipFile(WHEEL) as old, zipfile.ZipFile(candidate) as new:
            changed = {builder.MODULE, f"{builder.DIST}/WHEEL", f"{builder.DIST}/RECORD"}
            for name in old.namelist():
                if name not in changed:
                    self.assertEqual(old.read(name), new.read(name), name)
            self.assertIn(b"Version: 1.11.0\n", new.read(f"{builder.DIST}/METADATA"))
            self.assertTrue(any("LICENSE" in name for name in new.namelist()))
            rows = list(csv.reader(io.StringIO(new.read(f"{builder.DIST}/RECORD").decode())))
            self.assertEqual({row[0] for row in rows}, set(new.namelist()))
            for name, digest, size in rows:
                if name.endswith("/RECORD"):
                    self.assertEqual((digest, size), ("", ""))
                else:
                    content = new.read(name)
                    expected = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode()
                    self.assertEqual(digest, "sha256=" + expected)
                    self.assertEqual(int(size), len(content))
            before = ast.parse(old.read(builder.MODULE))
            after = ast.parse(new.read(builder.MODULE))
            original = next(n for n in before.body if isinstance(n, ast.FunctionDef) and n.name == "load_checkpoint_in_model")
            patched = copy.deepcopy(next(n for n in after.body if isinstance(n, ast.FunctionDef) and n.name == original.name))
            old_if = next(n for n in ast.walk(original) if isinstance(n, ast.If) and ast.unparse(n.test) == "index_filename is not None")
            new_if = next(n for n in ast.walk(patched) if isinstance(n, ast.If) and ast.unparse(n.test) == "index_filename is not None")
            self.assertIn("_drapixai_checkpoint_files", ast.unparse(new_if.body[-1]))
            new_if.body[-1:] = copy.deepcopy(old_if.body[-2:])
            self.assertEqual(ast.dump(original), ast.dump(patched), "Tensor-loading operations or API changed")
            original_functions = {n.name: ast.dump(n) for n in before.body if isinstance(n, ast.FunctionDef) and n.name != original.name}
            for node in after.body:
                if isinstance(node, ast.FunctionDef) and node.name in original_functions:
                    self.assertEqual(ast.dump(node), original_functions[node.name], node.name)

    def test_tampered_upstream_and_unapproved_output_rejected(self):
        bad = self.root / "tampered.whl"
        bad.write_bytes(WHEEL.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "WHEEL_HASH_MISMATCH"):
            builder.build(bad, self.root / "bad")
        with self.assertRaisesRegex(ValueError, "OUTPUT_OUTSIDE"):
            builder.build(WHEEL, HERE / "never-create")
        with self.assertRaisesRegex(ValueError, "LOADER_HASH_MISMATCH"):
            builder.patched_source(b"changed", "")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheel", type=Path, required=True)
    args, remaining = parser.parse_known_args()
    WHEEL = args.wheel.resolve(strict=True)
    unittest.main(argv=[__file__, *remaining])
