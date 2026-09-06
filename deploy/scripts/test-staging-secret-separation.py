"""Exercise staging secret generation with synthetic billing configuration."""

import contextlib
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
                with self.assertRaisesRegex(SystemExit, "Refusing to rotate"):
                    generator.main()
                self.assertEqual((root / "postgres_password").read_text(), bootstrap_password)
                self.assertEqual((root / "api_database_password").read_text(), runtime_password)


if __name__ == "__main__":
    unittest.main()
