import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('node_candidate', HERE/'prepare-edge-candidate.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)
upstream_spec = importlib.util.spec_from_file_location('node_upstream', HERE/'verify-upstream.py')
upstream = importlib.util.module_from_spec(upstream_spec)
upstream_spec.loader.exec_module(upstream)


class UpstreamEvidence(unittest.TestCase):
    def test_incomplete_failed_or_skipped_subsystems_cannot_report_pass(self):
        complete = '''Total: 4 tests
 *    0 tests will be skipped
 *    4 tests are expected to pass
 *    0 tests are expected to fail that we won't fix
 *    0 tests are expected to fail that we should fix
TAP version 13
1..4
ok 1 parallel/test-crypto-a.js
ok 2 parallel/test-tls-b.js
ok 3 parallel/test-https-c.js
ok 4 parallel/test-http2-d.js
'''
        cases = {
            'valid': (complete, True),
            'empty': ('', False),
            'truncated': (complete.rsplit('ok 4', 1)[0], False),
            'missing-plan': (complete.replace('1..4\n', ''), False),
            'duplicate-plan': (complete+'1..4\n', False),
            'missing-summary': (complete[complete.index('TAP version'):], False),
            'duplicate-case': (complete.replace('ok 3', 'ok 2'), False),
            'failed-case': (complete.replace('ok 4', 'not ok 4'), False),
            'todo-case': (complete.replace('http2-d.js', 'http2-d.js # TODO'), False),
            'whole-subsystem-skipped': (complete.replace('http2-d.js', 'http2-d.js # skip unavailable'), False),
            'expected-failure': (complete.replace('0 tests are expected to fail that we should fix',
                                                  '1 tests are expected to fail that we should fix'), False),
            'subsystem-in-unrelated-name': (complete.replace('test-http2-d.js',
                                                              'test-other-d.js parallel/test-http2-fake'), False),
        }
        for name, (text, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(upstream.parse_tap(text)['passed'], expected)


class CandidateInputs(unittest.TestCase):
    def setUp(self):
        self.prefix = (HERE/'Dockerfile.shared-openssl').read_text()
        self.original = {role: subprocess.check_output(['git', 'show', f'HEAD:apps/{role}/Dockerfile'], cwd=candidate.ROOT, text=True) for role in ['api', 'web']}

    def test_both_roles_keep_application_commands_and_use_shared_binary(self):
        for role, original in self.original.items():
            rendered = candidate.render(original, self.prefix, role)
            self.assertIn(' AS node-source-build\n', rendered)
            self.assertIn('/opt/drapixai-node/bin/node /usr/local/bin/node', rendered)
            self.assertIn('/opt/drapixai-node/bin/node /nodejs/bin/node', rendered)
            self.assertIn('io.drapixai.node-channel="shared-openssl-review-candidate"', rendered)
            self.assertIn(original.split('CMD ', 1)[1], rendered)
            self.assertNotIn('--from=patched-openssl ', rendered)
            self.assertIn('npm ci --include=dev', rendered)

    def test_unknown_node_major_refuses_rewrite(self):
        with self.assertRaisesRegex(ValueError, 'Unreviewed production'):
            candidate.render(self.original['api'].replace('node:22-', 'node:24-'), self.prefix, 'api')

    def test_missing_runtime_guard_refuses_rewrite(self):
        with self.assertRaisesRegex(ValueError, 'Unreviewed production'):
            candidate.render(self.original['web'].replace(' AS runtime', ' AS unknown'), self.prefix, 'web')

    def test_unknown_overlay_shape_refuses_rewrite(self):
        with self.assertRaisesRegex(ValueError, 'Unreviewed production'):
            candidate.render(self.original['api'].replace('--from=patched-openssl', '--from=other'), self.prefix, 'api')

    def test_unknown_source_builder_refuses_rewrite(self):
        with self.assertRaisesRegex(ValueError, 'Unreviewed Node candidate'):
            candidate.render(self.original['api'], self.prefix.replace('COPY record-build.py ', 'COPY other.py '), 'api')

    def test_output_cannot_escape_candidate_directory(self):
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=candidate.ROOT, text=True).strip()
        with self.assertRaisesRegex(ValueError, 'below runtime/security-candidate'):
            candidate.materialize(commit, candidate.ROOT/'apps/api')

    def test_mutable_or_invalid_git_ref_is_rejected(self):
        for ref in ['HEAD', 'main', '../input', 'a'*39]:
            with self.assertRaisesRegex(ValueError, 'exact 40-character'):
                candidate.materialize(ref, candidate.ROOT/'runtime/security-candidate/unused')

    def test_context_preserves_committed_blob_bytes(self):
        parent = candidate.ROOT/'runtime/security-candidate'
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='node-source-test-', dir=parent) as temporary:
            self.assertTrue(Path(temporary).resolve().is_relative_to(parent.resolve()))
            commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=candidate.ROOT, text=True).strip()
            output = Path(temporary)/'candidate'
            record = candidate.materialize(commit, output)
            for filename in ['apps/api/Dockerfile', 'apps/web/Dockerfile', 'deploy/release/standard-catvton-rc1.env']:
                original = subprocess.check_output(['git', 'show', f'{commit}:{filename}'], cwd=candidate.ROOT)
                self.assertEqual((output/'context'/filename).read_bytes(), original)
            checks = Path(record['applicationChecksDockerfile']['path']).read_text()
            self.assertIn('node_shared_openssl,true', checks)
            self.assertIn('apt-get install -y --no-install-recommends git', checks)
            self.assertIn('git init --quiet && git add --all', checks)
            self.assertLess(checks.index('git init --quiet'), checks.index('npm --prefix apps/api ci'))
            ignore = Path(record['applicationChecksDockerignore']['path'])
            self.assertEqual(ignore.name, Path(record['applicationChecksDockerfile']['path']).name+'.dockerignore')
            self.assertEqual(ignore.read_bytes(), b'.git\n**/.git\n')
            self.assertEqual(record['applicationChecksDockerignore']['sha256'], candidate.sha(ignore.read_bytes()))


if __name__ == '__main__':
    unittest.main()
