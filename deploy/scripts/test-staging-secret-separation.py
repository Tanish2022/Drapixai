"""Exercise staging secret generation with synthetic billing configuration."""

import contextlib
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlparse


spec = importlib.util.spec_from_file_location(
    "staging_secrets", Path(__file__).with_name("generate-staging-secrets.py")
)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class SecretSeparationTests(unittest.TestCase):
    def test_private_replacement_never_changes_a_linked_target(self):
        with tempfile.TemporaryDirectory(prefix="drapixai-secret-write-test-") as directory:
            root = Path(directory)
            target, destination = root / "unrelated", root / "secret"
            target.write_text("preserve-unrelated")
            os.link(target, destination)
            generator.write_private(destination, "synthetic-new-value")
            self.assertEqual(target.read_text(), "preserve-unrelated")
            self.assertEqual(destination.read_text(), "synthetic-new-value")
            if os.name != "nt":
                self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertFalse(list(root.glob(".secret.*")))

    def test_runtime_database_identity_is_separate_and_existing_files_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix="drapixai-secret-test-") as directory:
            root = Path(directory)
            environment = {
                "DRAPIXAI_STRIPE_SECRET_KEY": "sk_test_" + "synthetic" * 8,
                "DRAPIXAI_STRIPE_WEBHOOK_SECRET": "whsec_" + "synthetic" * 8,
            }
            with patch.dict(os.environ, environment), patch(
                "sys.argv", ["generate-staging-secrets.py", "--output-dir", directory]
            ), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(generator.main(), 0)
                api = json.loads((root / "drapixai-api.json").read_text())
                database = urlparse(api["DATABASE_URL"])
                bootstrap_password = (root / "postgres_password").read_text()
                runtime_password = (root / "api_database_password").read_text()
                self.assertEqual(database.username, "drapixai_staging_api")
                self.assertEqual(database.hostname, "postgres")
                self.assertEqual(database.path, "/drapixai_staging")
                self.assertEqual(unquote(database.password), runtime_password)
                self.assertNotEqual(bootstrap_password, runtime_password)
                self.assertNotIn(bootstrap_password, json.dumps(api))
                self.assertGreaterEqual(len(runtime_password), 32)
                seed = api["DRAPIXAI_ADMIN_TOTP_SECRET"]
                self.assertEqual(len(seed), 32)
                self.assertEqual(len(base64.b32decode(seed, casefold=False)), 20)
                original_files = {path.name: path.read_bytes() for path in root.iterdir()}
                with self.assertRaisesRegex(SystemExit, "Refusing to rotate"):
                    generator.main()
                self.assertEqual((root / "postgres_password").read_text(), bootstrap_password)
                self.assertEqual((root / "api_database_password").read_text(), runtime_password)
                self.assertEqual({path.name: path.read_bytes() for path in root.iterdir()}, original_files)


if __name__ == "__main__":
    unittest.main()
