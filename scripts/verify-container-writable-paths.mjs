import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const [apiRef, webRef] = process.argv.slice(2);
assert.ok(apiRef && webRef, 'Usage: node scripts/verify-container-writable-paths.mjs <api-image> <web-image>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = crypto.randomBytes(8).toString('hex');
const label = `drapixai.writable-paths-fixture=${id}`;
const evidence = path.join(root, 'runtime/launch-evidence');
fs.mkdirSync(evidence, { recursive: true });
const emptyEnv = path.join(evidence, `empty-compose-env-${id}`);
fs.writeFileSync(emptyEnv, '');
const modelRoot = fs.mkdtempSync(path.join(evidence, 'compose-model-'));
const output = path.join(evidence, `edge-writable-paths-${id}.json`);
const report = { passed: false, scope: 'Docker-resolved production/staging template tmpfs settings against actual non-root images in disposable networkless containers; not live deployment or full server startup', source: {}, images: {}, checks: [] };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
report.verifierSha256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
const invoke = (args, env = process.env) => spawnSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, env });
const docker = (args, env) => { const result = invoke(args, env); assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout || 'Docker operation failed'); return result.stdout.trim(); };
const probe = String.raw`
  const fs = require('node:fs'), assert = require('node:assert/strict');
  const [directory, expectation] = process.argv.slice(1);
  const stat = fs.statSync(directory), file = directory + '/synthetic-owned-write-probe';
  assert.notEqual(process.getuid(), 0);
  let error = null;
  try { fs.writeFileSync(file, 'synthetic-only', { flag: 'wx' }); assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic-only'); fs.unlinkSync(file); }
  catch (failure) { error = failure.code; }
  if (expectation === 'denied') assert.equal(error, 'EACCES');
  else { assert.equal(error, null); assert.equal(stat.uid, process.getuid()); assert.equal(stat.gid, process.getgid()); assert.equal(stat.mode & 0o777, 0o700); }
  assert.ok(fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => line.includes(' ' + directory + ' ') && line.includes(' - tmpfs ')));
  assert.throws(() => fs.writeFileSync('/outside-tmpfs-probe', 'synthetic-only'), e => ['EROFS', 'EACCES'].includes(e.code));
  console.log(JSON.stringify({ uid: process.getuid(), gid: process.getgid(), directoryUid: stat.uid, directoryGid: stat.gid, mode: stat.mode & 0o777, error, expectation }));
`;
try {
  for (const [role, ref] of [['api', apiRef], ['web', webRef]]) {
    const image = JSON.parse(docker(['image', 'inspect', ref]))[0];
    assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
    assert.ok(image.Config.User && !['root', '0'].includes(image.Config.User));
    report.images[role] = { imageId: image.Id, configuredUser: image.Config.User, revision: image.Config.Labels?.['org.opencontainers.image.revision'] || null };
  }
  // Never inspect a real deployment env file, even on Compose versions which
  // validate required env_file paths before applying --no-env-resolution.
  // Resolve byte-identical templates in an owned mirror with empty fixture files.
  fs.mkdirSync(path.join(modelRoot, 'deploy/env'), { recursive: true });
  for (const name of ['api.production.env', 'web.production.env', 'api.staging.env', 'web.staging.env']) {
    fs.writeFileSync(path.join(modelRoot, 'deploy/env', name), '');
  }
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('COMPOSE_'))), DRAPIXAI_API_RELEASE_IMAGE: report.images.api.imageId, DRAPIXAI_WEB_RELEASE_IMAGE: report.images.web.imageId,
    DRAPIXAI_POSTGRES_IMAGE: 'postgres:16-alpine', DRAPIXAI_REDIS_IMAGE: 'redis:7-alpine', DRAPIXAI_TRYON_INTAKE_ENABLED: '0',
    DRAPIXAI_REDIS_PASSWORD: 'synthetic-compose-model-only', DRAPIXAI_INTERNAL_TLS_SECRETS_DIR: '/synthetic-not-mounted', DRAPIXAI_STAGING_API_PORT: '18000', DRAPIXAI_STAGING_WEB_PORT: '13000' };
  for (const source of ['deploy/docker-compose.edge.yml', 'deploy/staging/docker-compose.edge.yml']) {
    const bytes = fs.readFileSync(path.join(root, source));
    report.source[source] = hash(bytes);
    const mirror = path.join(modelRoot, source);
    fs.mkdirSync(path.dirname(mirror), { recursive: true });
    fs.writeFileSync(mirror, bytes);
    assert.equal(hash(fs.readFileSync(mirror)), report.source[source]);
    // Only the isolated empty files and synthetic interpolation values exist
    // here; no actual deployment secrets are read and no service is started.
    const model = JSON.parse(docker(['compose', '--env-file', emptyEnv, '-f', mirror, 'config', '--no-env-resolution', '--format', 'json'], env));
    for (const [role, target] of [['api', '/app/apps/api/uploads'], ['web', '/app/apps/web/.next/cache']]) {
      const service = model.services[role];
      assert.equal(service.image, report.images[role].imageId);
      assert.equal(service.read_only, true); assert.ok(!service.privileged && !service.user, 'Do not override the tested image identity');
      assert.ok(service.cap_drop.includes('ALL') && !service.cap_add);
      const mounts = service.tmpfs.filter(value => value.startsWith(`${target}:`));
      assert.equal(mounts.length, 1, `${source}:${role} must have one dedicated tmpfs`);
      const mount = mounts[0];
      assert.match(mount.slice(target.length + 1), /^(?:[a-z]+=[a-z0-9]+)(?:,[a-z]+=[a-z0-9]+)*$/i);
      assert.ok(!service.volumes?.some(volume => volume.target === target), 'A persistent mount must not shadow the tmpfs');
      for (const [expectation, option] of [['denied', mount.replace(/uid=\d+/, 'uid=1000').replace(/gid=\d+/, 'gid=1000')], ['writable', mount]]) {
        const result = JSON.parse(docker(['run', '--pull=never', '--rm', '--label', label, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--memory', '128m', '--cpus', '1', '--pids-limit', '64', '--ulimit', 'core=0', '--tmpfs', option, report.images[role].imageId, '-e', probe, target, expectation]));
        report.checks.push({ source, role, target, mount: option, ...result });
      }
    }
  }
  report.composeModelScope = 'Byte-identical templates resolved in an isolated mirror with four empty fixture env files; no deployment env files read';
  assert.equal(report.checks.length, 8); report.passed = true;
} catch (error) { report.failure = String(error.message); process.exitCode = 1; }
finally {
  const owned = invoke(['ps', '-aq', '--filter', `label=${label}`]);
  if (owned.status !== 0) { report.passed = false; report.cleanupFailure = 'Cannot inspect owned fixture containers'; process.exitCode = 1; }
  else for (const cid of owned.stdout.trim().split(/\s+/).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/.test(cid) || invoke(['rm', '-fv', cid]).status !== 0) { report.passed = false; report.cleanupFailure = 'Cannot remove owned fixture container'; process.exitCode = 1; }
  }
  fs.rmSync(emptyEnv, { force: true });
  assert.equal(path.dirname(modelRoot), evidence);
  assert.ok(path.basename(modelRoot).startsWith('compose-model-'));
  fs.rmSync(modelRoot, { recursive: true, force: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, evidence: path.relative(root, output), failure: report.failure || report.cleanupFailure || null }));
}
