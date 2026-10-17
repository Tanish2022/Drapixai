"""Run the real scanner shell boundary with fake Docker/Git, never a daemon."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).with_name("scan-container-images.sh")
VEX = SOURCE.parent.parent / "security/vex/drapixai-container.openvex.json"
REVISION = "a" * 40

DOCKER = r'''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
if args==['info']: sys.exit(0)
if args[:2]==['image','inspect']:
    print('sha256:'+'b'*64 if args[3]=='{{.Id}}' else os.environ.get('FAKE_IMAGE_REVISION','a'*40))
elif args[:2]==['save','--output']:
    Path(args[2]).write_bytes(b'synthetic archive, never passed to a real scanner')
elif args[0]=='run':
    assert '/var/run/docker.sock' not in ' '.join(args)
    assert args[args.index('--cap-drop')+1]=='ALL'
    assert '--read-only' in args
    repos=args[args.index('--db-repository')+1]
    expected=os.environ.get('DRAPIXAI_TRIVY_DB_REPOSITORY','mirror.gcr.io/aquasec/trivy-db:2,ghcr.io/aquasecurity/trivy-db:2,public.ecr.aws/aquasecurity/trivy-db:2')
    assert repos==expected, (repos,expected)
    state=Path(os.environ['FAKE_CALLS'])
    attempt=int(state.read_text())+1 if state.exists() else 1
    state.write_text(str(attempt))
    mode=os.environ['FAKE_SCAN_MODE']
    if mode=='transient' and attempt==1:
        print('TOOMANYREQUESTS: synthetic registry outage\n\n',file=sys.stderr)
        sys.exit(37)
    if mode=='empty': sys.exit(0)
    if mode=='malformed': print('{'); sys.exit(0)
    if mode=='missing-results': print('{}'); sys.exit(0)
    vulns=[{'VulnerabilityID':'CVE-SYNTHETIC','Severity':'HIGH','PkgName':'fixture','InstalledVersion':'1'}] if mode=='vulnerable' else []
    print(json.dumps({'Results':[{'Vulnerabilities':vulns}]}))
    if mode=='failed-with-json':
        print('TOOMANYREQUESTS: synthetic partial report\n\n',file=sys.stderr)
        sys.exit(37)
else: raise AssertionError(args)
'''
GIT = r'''#!/usr/bin/env python3
import os,sys
if sys.argv[-2:]==['rev-parse','HEAD']: print('a'*40)
elif sys.argv[-2:]==['status','--porcelain']:
    if os.environ.get('FAKE_DIRTY'): print(' M source')
else: raise AssertionError(sys.argv)
'''


class ScannerBoundaryTests(unittest.TestCase):
    def scenario(self, mode, expected, calls=1, **overrides):
        with tempfile.TemporaryDirectory(prefix="drapixai-scanner-test-") as directory:
            root = Path(directory)
            scripts = root / "deploy/scripts"
            policy = root / "deploy/security/vex"
            scripts.mkdir(parents=True)
            policy.mkdir(parents=True)
            shutil.copyfile(SOURCE, scripts / SOURCE.name)
            shutil.copyfile(VEX, policy / VEX.name)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            for name, content in [("docker", DOCKER), ("git", GIT), ("sleep", "#!/usr/bin/env python3\n")]:
                command = fake_bin / name
                command.write_text(content)
                command.chmod(0o755)
            evidence = root / "runtime/launch-evidence/scan.json"
            count = root / "calls"
            env = {key: value for key, value in os.environ.items() if not key.startswith("DRAPIXAI_")}
            env.update(PATH=str(fake_bin) + os.pathsep + os.environ["PATH"],
                       DRAPIXAI_CONTAINER_SCAN_EVIDENCE=str(evidence),
                       FAKE_CALLS=str(count), FAKE_SCAN_MODE=mode, GITHUB_ACTIONS="true")
            env.update(overrides)
            result = subprocess.run(["bash", str(scripts / SOURCE.name), "synthetic:image"],
                                    env=env, text=True, capture_output=True, timeout=30)
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, expected, output)
            self.assertEqual(int(count.read_text()) if count.exists() else 0, calls, output)
            if not evidence.exists():
                self.assertNotEqual(expected, 0)
                return
            record = json.loads(evidence.read_text())
            self.assertEqual(record["releaseCommit"], REVISION)
            self.assertEqual(record["status"], "PASS" if expected == 0 else "FAIL")
            image = record["images"][0]
            self.assertEqual(image["scannerExitCode"], expected)
            if expected == 0:
                self.assertTrue(image["reportSha256"])
                self.assertTrue((root / image["report"]).is_file())
            else:
                self.assertNotIn("No HIGH/CRITICAL", output)
            if mode == "failed-with-json":
                self.assertIn("TOOMANYREQUESTS", output)
                self.assertIn("command exit 37", output)
                self.assertIn("partial report", image["scannerError"])
            if mode == "empty":
                self.assertIsNone(image["reportSha256"])

    def test_clean_report(self): self.scenario("clean", 0)
    def test_high_finding_blocks(self): self.scenario("vulnerable", 10)
    def test_nonzero_with_valid_json_blocks(self): self.scenario("failed-with-json", 20, calls=3, DRAPIXAI_TRIVY_DB_REPOSITORY="ghcr.io/aquasecurity/trivy-db:2")
    def test_empty_report_blocks(self): self.scenario("empty", 20)
    def test_malformed_report_blocks(self): self.scenario("malformed", 20)
    def test_missing_results_blocks(self): self.scenario("missing-results", 20)
    def test_transient_failure_recovers(self): self.scenario("transient", 0, calls=2)
    def test_explicit_repository_override(self): self.scenario("clean", 0, DRAPIXAI_TRIVY_DB_REPOSITORY="ghcr.io/aquasecurity/trivy-db:2")
    def test_image_revision_mismatch_blocks_before_scanner(self): self.scenario("clean", 21, calls=0, FAKE_IMAGE_REVISION="c"*40)
    def test_dirty_checkout_blocks_before_scanner(self): self.scenario("clean", 2, calls=0, FAKE_DIRTY="1")


if __name__ == "__main__":
    unittest.main(verbosity=2)
