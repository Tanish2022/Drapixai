#!/usr/bin/env python3
"""Offline regression tests for the GPU image evidence certification boundary."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
COMMIT = "a" * 40
STALE_COMMIT = "b" * 40
IMAGE = "registry.example/drapixai/ai@sha256:" + "c" * 64
OTHER_IMAGE = "registry.example/drapixai/ai@sha256:" + "d" * 64
PREFIX = "DRAPIXAI_RELEASE_IMAGE_EVIDENCE_V1="
MARKER = "PASS: Staging ai services use expected release image digests and revision "
READER = ROOT / "deploy/staging/verify-gpu-image-evidence.py"


def evidence(commit=COMMIT, image=IMAGE):
    return {
        "schema_version": 1,
        "role": "ai",
        "release_commit": commit,
        "services": {
            name: {"image": image, "revision": commit}
            for name in ("ai-api", "ai-worker")
        },
    }


def render(record=None, marker_commit=COMMIT):
    return PREFIX + json.dumps(record or evidence(), separators=(",", ":")) + "\n" + MARKER + marker_commit + "\n"


class EvidenceFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="drapixai-certification-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.images = self.directory / "images.env"
        self.images.write_text(
            f"DRAPIXAI_RELEASE_COMMIT={COMMIT}\nDRAPIXAI_AI_RELEASE_IMAGE={IMAGE}\n", encoding="utf-8"
        )
        self.log = self.directory / "gpu-images.out"
        self.log.write_text(render(), encoding="utf-8")

    def verify(self, content=None):
        if content is not None:
            self.log.write_text(content, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(READER), "--evidence", str(self.log),
             "--images-env", str(self.images), "--expected-commit", COMMIT],
            capture_output=True, text=True, timeout=10,
        )

    def reject(self, content):
        result = self.verify(content)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)
        self.assertNotIn(MARKER, result.stdout)


class EvidenceTests(EvidenceFixture):
    def test_exact_release_and_both_image_identities_pass(self):
        result = self.verify()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout.splitlines()[0][len(PREFIX):]), evidence())

    def test_stale_release_cannot_pass_with_current_marker(self):
        self.reject(render(evidence(STALE_COMMIT)))

    def test_legacy_pass_line_is_not_sufficient(self):
        for commit in (COMMIT, STALE_COMMIT):
            with self.subTest(commit=commit):
                self.reject(MARKER + commit + "\n")

    def test_wrong_image_or_worker_revision_rejected(self):
        for service in ("ai-api", "ai-worker"):
            for key, value in (("image", OTHER_IMAGE), ("revision", STALE_COMMIT)):
                with self.subTest(service=service, key=key):
                    record = evidence()
                    record["services"][service][key] = value
                    self.reject(render(record))

    def test_image_record_must_match_expected_release(self):
        self.images.write_text(f"DRAPIXAI_RELEASE_COMMIT={STALE_COMMIT}\nDRAPIXAI_AI_RELEASE_IMAGE={IMAGE}\n")
        self.reject(render())

    def test_image_record_rejects_unpinned_missing_duplicate_and_executable_values(self):
        for source in (
            f"DRAPIXAI_RELEASE_COMMIT={COMMIT}\nDRAPIXAI_AI_RELEASE_IMAGE=registry.example/drapixai/ai:latest\n",
            f"DRAPIXAI_RELEASE_COMMIT={COMMIT}\n",
            self.images.read_text() + f"DRAPIXAI_AI_RELEASE_IMAGE={OTHER_IMAGE}\n",
            self.images.read_text() + "export DRAPIXAI_RELEASE_COMMIT=$(echo SECRET_SENTINEL)\n",
            self.images.read_text() + "echo SECRET_SENTINEL\n",
        ):
            with self.subTest(source=source):
                self.images.write_text(source)
                self.reject(render())

    def test_missing_extra_services_and_edge_role_rejected(self):
        for mutation in ("missing", "extra", "role", "schema", "schema-bool", "field"):
            record = evidence()
            if mutation == "missing":
                del record["services"]["ai-worker"]
            elif mutation == "extra":
                record["services"]["unreviewed-worker"] = record["services"]["ai-api"]
            elif mutation == "role":
                record["role"] = "edge"
            elif mutation == "schema":
                record["schema_version"] = 2
            elif mutation == "schema-bool":
                record["schema_version"] = True
            else:
                record["unexpected"] = "SECRET_SENTINEL"
            with self.subTest(mutation=mutation):
                self.reject(render(record))

    def test_stale_malformed_substring_and_mixed_output_rejected(self):
        valid = render()
        for content in (
            valid.replace(MARKER + COMMIT, MARKER + STALE_COMMIT),
            valid.replace(MARKER, "FAIL then " + MARKER),
            valid + "FAIL: ai-worker is not running\n",
            "ERROR: SECRET_SENTINEL\n" + valid,
            valid + valid,
            PREFIX + "{SECRET_SENTINEL\n" + MARKER + COMMIT,
            valid.replace('"schema_version":1', '"schema_version":0,"schema_version":1'),
            valid.replace('"schema_version":1', '"schema_version":NaN'),
            PREFIX + "[]\n" + MARKER + COMMIT,
            "x" * 65537,
        ):
            with self.subTest(content=content[:150]):
                self.reject(content)

    def test_quoted_exported_image_record_and_crlf_supported(self):
        self.images.write_text(f"# Non-secret images\nexport DRAPIXAI_RELEASE_COMMIT='{COMMIT}'\nDRAPIXAI_AI_RELEASE_IMAGE=\"{IMAGE}\" # approved\n")
        result = self.verify(render().replace("\n", "\r\n"))
        self.assertEqual(result.returncode, 0, result.stderr)


class CertificationIntegrationTests(EvidenceFixture):
    """Exercise the actual shell entry points with local command stubs only."""

    def setUp(self):
        super().setUp()
        self.bash = os.environ.get("DRAPIXAI_TEST_BASH") or shutil.which("bash")
        self.assertTrue(self.bash, "Bash is required for offline shell integration tests; run this gate on Linux")
        self.repo = self.directory / "repo"
        staging = self.repo / "deploy/staging"
        staging.mkdir(parents=True)
        shutil.copy2(ROOT / "deploy/staging/certify-release.sh", staging)
        shutil.copy2(ROOT / "deploy/staging/verify-release-images.sh", staging)
        if READER.exists():
            shutil.copy2(READER, staging)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        self.trace = self.directory / "trace"
        self.environment = dict(os.environ)
        self.environment.update({
            "PATH": str(self.bin) + os.pathsep + os.environ.get("PATH", ""),
            "DRAPIXAI_TEST_PYTHON": sys.executable.replace("\\", "/"),
            "DRAPIXAI_TEST_TRACE": str(self.trace).replace("\\", "/"),
            "DRAPIXAI_TEST_COMMIT": COMMIT,
            "DRAPIXAI_TEST_IMAGE": IMAGE,
            "DRAPIXAI_TEST_BIN": str(self.bin).replace("\\", "/"),
        })
        self.stub("git", 'case "$*" in *status*) exit 0;; *) printf "%s\\n" "$DRAPIXAI_TEST_COMMIT";; esac\n')
        for name in ("node", "npm"):
            self.stub(name, 'echo "unexpected command" >&2; exit 99\n')
        self.stub("python3", 'case "$1" in *verify-gpu-image-evidence.py) exec "$DRAPIXAI_TEST_PYTHON" "$@";; *) printf "%s\\n" "next-certification-check" >> "$DRAPIXAI_TEST_TRACE"; exit 77;; esac\n')
        self.stub("docker", '''printf '%s\\n' "$*" >> "$DRAPIXAI_TEST_TRACE"
case "$*" in
  *" ps -q "*) printf 'fixture-container\\n';;
  "inspect "*) printf '%s\\n' "$DRAPIXAI_TEST_IMAGE";;
  "image inspect "*) printf '%s\\n' "$DRAPIXAI_TEST_COMMIT";;
  *) exit 99;;
esac
''')
        self.manifest = self.directory / "manifest.json"
        self.manifest.write_text("{}")
        self.mtls = self.directory / "mtls.out"
        self.mtls.write_text("\n".join((
            "PASS: GPU mTLS proxy requires client certificates",
            "PASS: GPU mTLS no-client handshake was rejected.",
            "PASS: GPU mTLS API-client handshake returned HTTP 200.",
            "PASS: GPU mTLS end-to-end handshake boundary passed.",
        )) + "\n")
        self.certification = self.directory / "certification.env"
        self.certification.write_text("\n".join(f"{key}='{str(value).replace(chr(92), '/')}'" for key, value in {
            "DRAPIXAI_STAGING_CERTIFICATION_ENVIRONMENT": "staging",
            "DRAPIXAI_STAGING_CERTIFICATION_API_URL": "https://api.staging.example.com",
            "DRAPIXAI_EXPECTED_GIT_REF": COMMIT,
            "DRAPIXAI_STAGING_IMAGES_ENV": self.images,
            "DRAPIXAI_THREE_TENANT_MANIFEST": self.manifest,
            "DRAPIXAI_GPU_MTLS_EVIDENCE": self.mtls,
            "DRAPIXAI_GPU_RELEASE_IMAGE_EVIDENCE": self.log,
            "DRAPIXAI_STRIX_EVIDENCE": self.manifest,
        }.items()) + "\n")

    def stub(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body, newline="\n")
        path.chmod(0o700)

    def certify(self):
        return self.run_shell(self.repo / "deploy/staging/certify-release.sh", self.certification)

    def run_shell(self, script, *arguments):
        # Git Bash rewrites inherited PATH on Windows; prepend the fixtures in Bash.
        launcher = 'fixture_bin="$DRAPIXAI_TEST_BIN"; if command -v cygpath >/dev/null 2>&1; then fixture_bin="$(cygpath -u "$fixture_bin")"; fi; export PATH="$fixture_bin:$PATH"; exec bash "$@"'
        return subprocess.run([self.bash, "-c", launcher, "offline-certification-test", str(script), *map(str, arguments)],
                              env=self.environment, capture_output=True, text=True, timeout=15)

    def test_current_producer_output_is_accepted_until_next_certification_obligation(self):
        producer = self.run_shell(self.repo / "deploy/staging/verify-release-images.sh", "ai", self.images, COMMIT)
        self.assertEqual(producer.returncode, 0, producer.stderr)
        self.log.write_text(producer.stdout)
        self.trace.unlink()
        result = self.certify()
        self.assertEqual(result.returncode, 77, result.stdout + result.stderr)
        self.assertEqual(self.trace.read_text().strip(), "next-certification-check")
        self.assertTrue(producer.stdout.startswith(PREFIX), producer.stdout)

    def test_legacy_stale_release_is_rejected_before_later_checks(self):
        self.log.write_text(MARKER + STALE_COMMIT + "\n")
        result = self.certify()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertFalse(self.trace.exists(), "Stale evidence reached later certification checks")

    def test_wrong_digest_and_failure_mixture_rejected_before_later_checks(self):
        for content in (render(evidence(image=OTHER_IMAGE)), render() + "FAIL: SECRET_SENTINEL\n"):
            with self.subTest(content=content[:150]):
                self.log.write_text(content)
                result = self.certify()
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertFalse(self.trace.exists())
                self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
