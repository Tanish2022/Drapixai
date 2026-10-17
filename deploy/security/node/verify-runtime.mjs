import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const [candidate, baseline] = process.argv.slice(2);
for (const value of [candidate, baseline]) assert.match(value || '', /^[a-zA-Z0-9][a-zA-Z0-9./:@_-]+$/, 'Provide local candidate and baseline image references');
const id = crypto.randomBytes(12).toString('hex');
const output = path.join(root, 'runtime/security-candidate/node-shared-openssl', `verify-${id}`);
fs.mkdirSync(output, { recursive: true });
const report = { scope: 'isolated downstream Node review candidate, not production promotion', passed: false,
  generatedAt: new Date().toISOString(), output, sourceCommit: '', dirtyCheckout: true, images: {}, smoke: null };
const invoke = (command, args, timeout = 180000) => spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 4*1024*1024 });
const run = (command, args, timeout) => {
  const result = invoke(command, args, timeout);
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout || 'Candidate verification failed');
  return result.stdout.trim();
};
const docker = (args) => run('docker', args);
const safety = ['--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--memory', '256m', '--cpus', '1', '--pids-limit', '64', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m'];
const cidFiles = [];
try {
  report.sourceCommit = run('git', ['rev-parse', 'HEAD']);
  report.dirtyCheckout = Boolean(run('git', ['status', '--porcelain']));
  report.inputSha256 = Object.fromEntries(['Dockerfile.shared-openssl', 'record-build.py', 'runtime-smoke.cjs', 'create-tls-fixtures.py', 'verify-runtime.mjs'].map(file =>
    [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')]));
  for (const [role, ref] of [['candidate', candidate], ['baseline', baseline]]) {
    const info = JSON.parse(docker(['image', 'inspect', ref]))[0];
    assert.match(info.Id, /^sha256:[a-f0-9]{64}$/);
    report.images[role] = { ref, imageId: info.Id, labels: info.Config.Labels || {} };
  }
  assert.equal(report.images.candidate.labels['io.drapixai.node-channel'], 'shared-openssl-review-candidate');
  const baselineProbe = JSON.parse(docker(['run', '--pull=never', '--rm', ...safety, report.images.baseline.imageId, '-e',
    "console.log(JSON.stringify({node:process.versions.node,openssl:process.versions.openssl,modules:process.versions.modules,icu:process.versions.icu,rootsSha256:require('node:crypto').createHash('sha256').update([...require('node:tls').rootCertificates].sort().join('\\0')).digest('hex')}))"]));
  assert.equal(baselineProbe.node, '22.23.3'); assert.equal(baselineProbe.modules, '127');
  report.baseline = baselineProbe;
  const fixtures = path.join(output, 'tls');
  run(process.env.DRAPIXAI_FIXTURE_PYTHON || 'python', [path.join(directory, 'create-tls-fixtures.py'), fixtures]);
  const probe = (role, imageId, extraMounts = []) => {
    const cidFile = path.join(output, `fixture-${role}.cid`); cidFiles.push(cidFile);
    return invoke('docker', ['run', '--pull=never', '--rm', '--cidfile', cidFile, '--name', `drapixai-node-shared-${role}-${id}`,
    '--label', `drapixai.fixture=${id}`, ...safety,
    '--env', `DRAPIXAI_BASELINE_ROOTS_SHA256=${baselineProbe.rootsSha256}`, '--env', `DRAPIXAI_BASELINE_ICU=${baselineProbe.icu}`, '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=1',
    '--mount', `type=bind,source=${directory},target=/probe,readonly`,
    '--mount', `type=bind,source=${fixtures},target=/fixtures,readonly`,
    ...extraMounts, imageId, '/probe/runtime-smoke.cjs']);
  };
  const positive = probe('positive', report.images.candidate.imageId);
  assert.equal(positive.status, 0, positive.error?.message || positive.stderr || positive.stdout);
  report.smoke = JSON.parse(positive.stdout);
  assert.equal(report.smoke.passed, true, report.smoke.failure);
  const provenance = JSON.parse(docker(['run', '--pull=never', '--rm', ...safety, report.images.candidate.imageId, '-e',
    "console.log(require('node:fs').readFileSync('/usr/share/drapixai/node-build-provenance.json','utf8'))"]));
  const controlFile = path.join(output, 'control-provenance.json');
  fs.writeFileSync(controlFile, JSON.stringify(provenance));
  const mountedRecord = ['--mount', `type=bind,source=${controlFile},target=/usr/share/drapixai/node-build-provenance.json,readonly`];
  const staticControl = probe('static-control', report.images.baseline.imageId, mountedRecord);
  assert.equal(staticControl.status, 1);
  const staticReport = JSON.parse(staticControl.stdout);
  assert.equal(staticReport.passed, false); assert.match(staticReport.failure, /false.*true/s);
  provenance.nodeSha256 = '0'.repeat(64);
  fs.writeFileSync(controlFile, JSON.stringify(provenance));
  const hashControl = probe('hash-control', report.images.candidate.imageId, mountedRecord);
  assert.equal(hashControl.status, 1);
  const hashReport = JSON.parse(hashControl.stdout);
  assert.equal(hashReport.passed, false); assert.match(hashReport.failure, /0000000000000000/);
  report.negativeControls = ['static original runtime rejected despite mounted candidate metadata', 'altered node digest rejected'];
  report.passed = true;
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  for (const cidFile of cidFiles) if (fs.existsSync(cidFile)) {
    const cid = fs.readFileSync(cidFile, 'utf8').trim();
    assert.match(cid, /^[a-f0-9]{64}$/);
    const inspection = invoke('docker', ['inspect', cid], 10000);
    if (inspection.status === 0) {
      const info = JSON.parse(inspection.stdout)[0];
      assert.equal(info.Config.Labels['drapixai.fixture'], id, 'Refusing to remove an unrelated container');
      docker(['rm', '-f', cid]);
    } else if (!/No such (object|container)/i.test(inspection.stderr)) {
      report.cleanupFailure = 'Unable to establish fixture container state'; report.passed = false; process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), checks: report.smoke?.checks, failure: report.failure }, null, 2));
}
