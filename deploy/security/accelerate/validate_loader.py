#!/usr/bin/env python3
"""Exercise installed Accelerate with tiny synthetic CPU tensors, never CatVTON.

Use only in a disposable venv. --expect-upstream-unsafe is a negative control
that verifies traversal actually loads an outside synthetic tensor, not a test
that can silently pass because the relevant loader path was never reached.
"""
from __future__ import annotations

import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import tempfile
import unittest

import torch
from accelerate import load_checkpoint_and_dispatch
from accelerate.utils import load_checkpoint_in_model
import accelerate.utils.modeling as modeling

BASELINE = False


class RealLoaderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="drapixai-loader-cpu-")
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.root = self.parent / "model"
        self.root.mkdir()
        self.weights = torch.tensor([[0.25, 0.5], [0.75, 1.0]])
        torch.save({"weight": self.weights}, self.root / "part.bin")
        torch.save({"weight": self.weights}, self.parent / "outside.bin")

    def load(self, name, dispatch):
        index = self.root / "pytorch_model.bin.index.json"
        index.write_text(json.dumps({"weight_map": {"weight": name}}), encoding="utf-8")
        model = torch.nn.Linear(2, 2, bias=False)
        if dispatch:
            load_checkpoint_and_dispatch(model, str(self.root), device_map={"": "cpu"})
        else:
            load_checkpoint_in_model(model, str(self.root), device_map={"": "cpu"})
        return model

    def test_valid_plain_nested_and_dot_paths_preserve_exact_tensors(self):
        (self.root / "shards").mkdir()
        torch.save({"weight": self.weights}, self.root / "shards/part.bin")
        for dispatch in [False, True]:
            for name in ["part.bin", "./part.bin", "shards/part.bin"]:
                with self.subTest(dispatch=dispatch, name=name):
                    model = self.load(name, dispatch)
                    self.assertTrue(torch.equal(model.weight.detach(), self.weights))
                    result = model(torch.tensor([[1.0, 2.0]]))
                    self.assertTrue(torch.equal(result, torch.tensor([[1.25, 2.75]])))

    def test_traversal_reaches_real_loader_before_patch_and_is_rejected_after(self):
        for dispatch in [False, True]:
            for name in ["../outside.bin", str((self.parent / "outside.bin").resolve())]:
                with self.subTest(dispatch=dispatch, absolute=Path(name).is_absolute()):
                    if BASELINE:
                        self.assertTrue(torch.equal(self.load(name, dispatch).weight.detach(), self.weights))
                    else:
                        with self.assertRaisesRegex(ValueError, "DRAPIXAI_CHECKPOINT_ESCAPE"):
                            self.load(name, dispatch)

    @unittest.skipIf(os.name == "nt", "Requires Linux for real FIFO, symlink and socket behavior")
    def test_non_regular_shards_fail_promptly_in_real_loader(self):
        if BASELINE:
            self.skipTest("Never send a FIFO to the unsafe baseline loader")
        (self.root / "link.bin").symlink_to(self.parent / "outside.bin")
        os.mkfifo(self.root / "fifo.bin")
        (self.root / "directory").mkdir()
        for dispatch in [False, True]:
            for name in ["link.bin", "fifo.bin", "directory"]:
                with self.subTest(dispatch=dispatch, name=name), self.assertRaises(ValueError):
                    self.load(name, dispatch)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect-upstream-unsafe", action="store_true")
    parser.add_argument("--candidate-record", type=Path)
    args, remaining = parser.parse_known_args()
    BASELINE = args.expect_upstream_unsafe
    if version("accelerate") != "1.11.0":
        raise SystemExit("Unexpected installed Accelerate version")
    source = Path(modeling.__file__).read_bytes()
    baseline_hash = "421a88fba25d6a50791fb54ea52e7eefd3beb678d1a131055176c09a87e820d6"
    actual_hash = hashlib.sha256(source).hexdigest()
    if BASELINE and actual_hash != baseline_hash:
        raise SystemExit("Unsafe negative control must use exact upstream loader")
    if not BASELINE and b"def _drapixai_checkpoint_files(" not in source:
        raise SystemExit("Review candidate guard is not installed")
    if BASELINE and args.candidate_record:
        raise SystemExit("A negative control cannot claim candidate evidence")
    if not BASELINE:
        if not args.candidate_record:
            raise SystemExit("Patched validation requires its exact build record")
        record = json.loads(args.candidate_record.read_text(encoding="utf-8"))
        if actual_hash != record.get("patched_loader_sha256") or record.get("status") != "REVIEW_CANDIDATE_NOT_APPROVED":
            raise SystemExit("Installed loader does not match the review candidate")
    print(json.dumps({"scope": "synthetic-cpu-loader-only-not-GPU-parity",
                      "mode": "upstream-unsafe-negative-control" if BASELINE else "patched-review-candidate",
                      "accelerate": version("accelerate"), "torch": torch.__version__,
                      "loader_sha256": actual_hash}), flush=True)
    unittest.main(argv=[__file__, *remaining])
