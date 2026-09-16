#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("model_artifacts", Path(__file__).with_name("verify-model-artifacts.py"))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class CheckpointLayoutTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "model"
        self.root.mkdir()

    def index(self, name):
        (self.root / "weights.index.json").write_text(json.dumps({"weight_map": {"layer.weight": name}}))

    def test_materialized_single_weight_is_unchanged(self):
        weight = self.root / "model.safetensors"
        weight.write_bytes(b"synthetic non-model bytes; never deserialize")
        before = weight.read_bytes()
        self.assertEqual(checker.verify(self.root), {"files": 1, "indexes": 0, "shardReferences": 0})
        self.assertEqual(weight.read_bytes(), before)

    def test_nested_shard_and_dot_prefix(self):
        (self.root / "shards").mkdir()
        (self.root / "shards" / "part.safetensors").write_bytes(b"synthetic")
        self.index("./shards/part.safetensors")
        self.assertEqual(checker.verify(self.root)["shardReferences"], 1)

    def test_escape_names_rejected(self):
        for name in ["../outside", "shards/../../outside", "/etc/passwd", "C:/outside", "C:outside", "\\\\host\\share", "shards\\part", "part\x00.bin"]:
            with self.subTest(name=name):
                self.index(name)
                with self.assertRaisesRegex(ValueError, "MODEL_INDEX_SHARD_ESCAPE"):
                    checker.verify(self.root)

    def test_missing_and_directory_shards_rejected(self):
        self.index("missing")
        with self.assertRaises(FileNotFoundError):
            checker.verify(self.root)
        (self.root / "directory").mkdir()
        self.index("directory")
        with self.assertRaisesRegex(ValueError, "MODEL_INDEX_SHARD_NOT_FILE"):
            checker.verify(self.root)

    def test_invalid_and_duplicate_maps(self):
        index = self.root / "weights.index.json"
        for data in ['{}', '[]', '{"weight_map":{}}', '{"weight_map":{"a":42}}', '{"weight_map":{"a":"one","a":"two"}}', '{"weight_map":{},"weight_map":{}}', '{bad json']:
            with self.subTest(data=data):
                index.write_text(data)
                with self.assertRaises(ValueError):
                    checker.verify(self.root)

    def test_oversized_index_rejected_before_parsing(self):
        index = self.root / "weights.index.json"
        with index.open("wb") as stream:
            stream.truncate(checker.MAX_INDEX_BYTES + 1)
        with self.assertRaisesRegex(ValueError, "MODEL_INDEX_TOO_LARGE"):
            checker.verify(self.root)

    def test_empty_or_missing_root(self):
        with self.assertRaisesRegex(ValueError, "MODEL_ROOT_EMPTY"):
            checker.verify(self.root)
        with self.assertRaises(FileNotFoundError):
            checker.verify(self.root / "missing")

    @unittest.skipIf(os.name == "nt", "Requires Linux CI for symlink semantics")
    def test_symlinks_rejected_including_directory_and_index(self):
        outside = self.root.parent / "outside"
        outside.write_bytes(b"synthetic")
        for name in ["part.safetensors", "weights.index.json", "linked-directory"]:
            link = self.root / name
            link.symlink_to(outside if name != "linked-directory" else self.root.parent)
            try:
                with self.assertRaisesRegex(ValueError, "MODEL_ARTIFACT_LINK_REJECTED"):
                    checker.verify(self.root)
            finally:
                link.unlink()

    @unittest.skipUnless(hasattr(os, "mkfifo"), "Requires Linux CI for FIFO semantics")
    def test_fifo_shard_and_index_rejected_without_opening(self):
        for name in ["part.bin", "weights.index.json"]:
            fifo = self.root / name
            os.mkfifo(fifo)
            try:
                with self.assertRaisesRegex(ValueError, "MODEL_ARTIFACT_NON_REGULAR"):
                    checker.verify(self.root)
            finally:
                fifo.unlink()

    @unittest.skipIf(os.name == "nt", "Requires Linux CI for deployment entrypoints")
    def test_services_validate_before_importing_application(self):
        app = self.root.parent / "app"
        app.mkdir()
        guard = app / "deploy" / "scripts" / "verify-model-artifacts.py"
        guard.parent.mkdir(parents=True)
        shutil.copyfile(Path(__file__).with_name(guard.name), guard)
        marker = app / "started"
        fake_start = "from pathlib import Path\nPath('started').write_text('started')\n"
        (app / "uvicorn.py").write_text(fake_start)
        worker = app / "drapixai_ai" / "worker" / "gpu_worker.py"
        worker.parent.mkdir(parents=True)
        worker.write_text(fake_start)
        (worker.parent / "__init__.py").touch()
        (worker.parent.parent / "__init__.py").touch()
        roots = [app / "models" / name for name in ["catvton", "base", "vae"]]
        for root in roots:
            root.mkdir(parents=True)
            (root / "model.safetensors").write_bytes(b"synthetic; never load")
        env = dict(os.environ, DRAPIXAI_APP_ROOT=str(app),
                   DRAPIXAI_AI_ENV_FILE=str(app / "absent.env"),
                   DRAPIXAI_VENV=str(app / "absent-venv"),
                   DRAPIXAI_TRYON_ENGINE="catvton",
                   DRAPIXAI_CATVTON_MODEL_DIR=str(roots[0]),
                   DRAPIXAI_CATVTON_BASE_MODEL=str(roots[1]),
                   DRAPIXAI_CATVTON_VAE_MODEL=str(roots[2]),
                   DRAPIXAI_TRANSIENT_SPOOL_DIR=str(app / "spool"))
        runpod = Path(__file__).resolve().parents[1] / "runpod"
        for script in ["start-ai-api.sh", "start-ai-worker.sh"]:
            valid = subprocess.run(["bash", str(runpod / script)], env=env, capture_output=True, timeout=10)
            self.assertEqual(valid.returncode, 0, valid.stderr.decode())
            self.assertTrue(marker.exists())
            marker.unlink()
            for root in roots:
                index = root / "model.index.json"
                index.write_text('{"weight_map":{"a":"../outside"}}')
                try:
                    invalid = subprocess.run(["bash", str(runpod / script)], env=env, capture_output=True, timeout=10)
                    self.assertNotEqual(invalid.returncode, 0)
                    self.assertIn(b"MODEL_INDEX_SHARD_ESCAPE", invalid.stdout)
                    self.assertFalse(marker.exists(), "Application imported before validation")
                finally:
                    index.unlink()


if __name__ == "__main__":
    unittest.main()
