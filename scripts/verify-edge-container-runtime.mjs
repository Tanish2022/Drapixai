import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [apiImage, webImage] = process.argv.slice(2);
assert.ok(apiImage && webImage, 'Usage: node scripts/verify-edge-container-runtime.mjs <api-image> <web-image>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgresImage = 'postgres:16-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4';
const runId = crypto.randomBytes(6).toString('hex');
const network = `drapixai-edge-runtime-${runId}`;
const database = `drapixai-edge-db-${runId}`;
const databaseName = 'drapixai_edge_test';
const web = `drapixai-edge-web-${runId}`;
const password = crypto.randomBytes(24).toString('hex');
const probeEnv = { ...process.env, POSTGRES_PASSWORD: password, DATABASE_URL: `postgresql://postgres:${password}@${database}:5432/${databaseName}`, DASHBOARD_SESSION_SECRET: crypto.randomBytes(32).toString('hex') };
const evidenceRoot = path.join(root, 'runtime/launch-evidence');
fs.mkdirSync(evidenceRoot, { recursive: true });
const reportFile = path.join(evidenceRoot, `edge-runtime-${runId}.json`);
const report = { scope: 'disposable-native-container-compatibility-not-live-staging', passed: false, generatedAt: new Date().toISOString(), images: {}, checks: [], failure: null };
const git = (args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, 'Unable to establish verifier checkout state');
  return result.stdout.trim();
};
const sourceCommit = git(['rev-parse', 'HEAD']);
assert.match(sourceCommit, /^[a-f0-9]{40}$/);
report.source = {
  commit: sourceCommit,
  dirtyEntries: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
  dockerfiles: Object.fromEntries(['apps/api/Dockerfile', 'apps/web/Dockerfile'].map((file) => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  dockerfilesScope: 'current verifier checkout inputs; not an attestation of tested image build inputs',
  verifierSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
};
const invoke = (args, env = process.env, input) => spawnSync('docker', args, { env, input, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const docker = (args, env) => {
  const result = invoke(args, env);
  assert.equal(result.status, 0, `Docker operation failed: ${result.error?.message || result.stderr || result.stdout}`);
  return result.stdout.trim();
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
const safety = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--cpus', '2', '--pids-limit', '128', '--ulimit', 'core=0', '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m'];
const commonProbe = String.raw`
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  assert.notEqual(process.getuid(), 0);
  assert.ok(Number(process.versions.node.split('.')[0]) >= 22 && Number(process.versions.node.split('.')[0]) < 25);
  assert.match(fs.readFileSync('/etc/os-release', 'utf8'), /VERSION_ID="13"/);
  const ssl = fs.readFileSync('/var/lib/dpkg/status.d/libssl3t64', 'utf8');
  assert.match(ssl, /Package: libssl3t64/);
  assert.ok(!fs.existsSync('/bin/sh'), 'Runtime must remain shell-free');
  assert.throws(() => fs.writeFileSync('/root-write-probe', 'synthetic'), error => ['EROFS', 'EACCES'].includes(error.code));
  require('node:tls').createSecureContext({ minVersion: 'TLSv1.2' });
`;
let networkCreated = false;
let databaseCreated = false;
let webCreated = false;
try {
  for (const [role, image] of [['api', apiImage], ['web', webImage]]) {
    const info = JSON.parse(docker(['image', 'inspect', image]))[0];
    assert.match(info.Id, /^sha256:[a-f0-9]{64}$/);
    assert.ok(info.Config.User && !['0', 'root'].includes(info.Config.User), `${role} image must default to a non-root user`);
    const revision = info.Config.Labels?.['org.opencontainers.image.revision'] || null;
    if (process.env.GITHUB_SHA) assert.equal(revision, process.env.GITHUB_SHA, 'CI image revision must match the tested commit');
    const runtimeVersions = JSON.parse(docker(['run', '--pull=never', '--rm', ...safety, '--network', 'none', info.Id, '-e', String.raw`console.log(JSON.stringify({node:process.versions.node,openssl:process.versions.openssl,embeddedOpenSSL:process.config.variables.node_shared_openssl?null:process.versions.openssl,sharedOpenSSL:process.config.variables.node_shared_openssl,uid:process.getuid(),systemOpenSSLPackage:require('node:fs').readFileSync('/var/lib/dpkg/status.d/libssl3t64','utf8').split('\n').find(line=>line.startsWith('Version:'))}))`]));
    assert.match(runtimeVersions.systemOpenSSLPackage || '', /^Version: \S+$/);
    report.images[role] = { image, imageId: info.Id, user: info.Config.User, revision, runtimeVersions };
  }
  docker(['network', 'create', '--internal', '--label', 'drapixai.purpose=disposable-edge-runtime-test', network]);
  networkCreated = true;
  docker(['run', '-d', '--name', database, '--network', network, '--label', 'drapixai.purpose=disposable-edge-runtime-test',
    '--memory', '512m', '--cpus', '2', '--pids-limit', '128', '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=${databaseName}`, postgresImage], probeEnv);
  databaseCreated = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const probe = invoke(['exec', database, 'psql', '-X', '-t', '-A', '-h', '127.0.0.1', '-U', 'postgres', '-d', databaseName, '-c', 'SELECT 1;']);
    if (probe.status === 0 && probe.stdout.trim() === '1') { ready = true; break; }
    await pause();
  }
  assert.ok(ready, 'Disposable PostgreSQL failed to start');
  const migrationRoot = path.join(root, 'apps/api/prisma/migrations');
  report.source.migrationSha256 = {};
  for (const name of fs.readdirSync(migrationRoot).sort()) {
    const file = path.join(migrationRoot, name, 'migration.sql');
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    report.source.migrationSha256[`apps/api/prisma/migrations/${name}/migration.sql`] = crypto.createHash('sha256').update(bytes).digest('hex');
    const applied = invoke(['exec', '-i', database, 'psql', '-X', '-q', '-h', '127.0.0.1', '-U', 'postgres', '-d', databaseName, '-v', 'ON_ERROR_STOP=1'], probeEnv, bytes);
    assert.equal(applied.status, 0, `Disposable schema migration ${name} failed: ${applied.stderr || applied.error?.message || ''}`);
  }
  docker(['run', '--pull=never', '--rm', ...safety, '--network', network, '-e', 'DATABASE_URL', report.images.api.imageId, '-e', `${commonProbe}
    (async () => {
      const sharp = require('sharp');
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#31725b' } }).png().toBuffer();
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.width, 16);
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      try { const result = await prisma.$queryRawUnsafe('SELECT 1 AS result'); assert.equal(result[0].result, 1); }
      finally { await prisma.$disconnect(); }
      const mail = await require('nodemailer').createTransport({ streamTransport: true, buffer: true }).sendMail({ from: 'fixture@example.invalid', to: 'fixture@example.invalid', subject: 'Offline fixture', text: 'Synthetic data only' });
      assert.ok(mail.message.length > 0);
      console.log('API native image, Prisma query and offline email fixture passed.');
    })().catch(error => { console.error(error.message); process.exit(1); });`], probeEnv);
  report.checks.push('api-nonroot-readonly-debian13-native-sharp-prisma-and-offline-mail');
  console.log('API native runtime compatibility passed against disposable PostgreSQL.');
  // Share only the owned database's network namespace, so the fixture's strict
  // loopback/disposable-DB guard remains intact. No host port is published.
  const passwordEnv = { ...probeEnv, DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:5432/${databaseName}?connection_limit=6&pool_timeout=10`,
    NODE_ENV: 'test', DRAPIXAI_DISPOSABLE_DB_APPROVAL: 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE', DRAPIXAI_AUDIT_LOG_SECRET: crypto.randomBytes(48).toString('hex') };
  const databaseOutput = docker(['run', '--pull=never', '--rm', ...safety, '--network', `container:${database}`,
    '-e', 'DATABASE_URL', '-e', 'NODE_ENV', '-e', 'DRAPIXAI_DISPOSABLE_DB_APPROVAL', '-e', 'DRAPIXAI_AUDIT_LOG_SECRET',
    report.images.api.imageId, '-e', `${commonProbe}
      require('node:assert/strict').equal(require('./dist/lib/password-hash.js').PASSWORD_WORK_LIMIT,2);
      require('node:assert/strict').equal(typeof require('./dist/scripts/password-session-database-tests.js').verifyPasswordSessions,'function');
      require('./dist/scripts/p0-database-tests.js');`], passwordEnv);
  assert.ok(databaseOutput.includes('PASS real PostgreSQL observed reset/issuer lock race denies stale login'));
  assert.ok(databaseOutput.includes('PASS real PostgreSQL key-insert failure rolls back'));
  report.passwordDatabaseFixture = { nodeEnv: 'test', scope: 'compiled P0 fixture in actual API image; not deployed production configuration',
    output: databaseOutput, outputSha256: crypto.createHash('sha256').update(databaseOutput).digest('hex') };
  report.checks.push('api-compiled-p0-password-reset-race-rollback-bootstrap-mfa-and-retention');
  console.log('Actual API image passed compiled password/MFA/retention database fixtures.');
  docker(['run', '--pull=never', '--rm', ...safety, '--network', 'none', report.images.web.imageId, '-e', `${commonProbe}
    (async () => { const sharp = require('sharp'); const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#31725b' } }).webp().toBuffer(); assert.ok(bytes.length > 0); console.log('Web native image fixture passed.'); })().catch(error => { console.error(error.message); process.exit(1); });`]);
  report.checks.push('web-nonroot-readonly-debian13-native-sharp');
  docker(['run', '--pull=never', '-d', '--name', web, ...safety, '--network', 'none', '-e', 'DASHBOARD_SESSION_SECRET', report.images.web.imageId], probeEnv);
  webCreated = true;
  let htmlPassed = false;
  for (let i = 0; i < 60; i++) {
    const result = invoke(['exec', web, '/nodejs/bin/node', '-e', String.raw`
      const assert = require('node:assert/strict');
      (async () => {
        const response = await fetch('http://127.0.0.1:3000/auth/register', { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        const nonce = /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy'))?.[1];
        assert.ok(nonce);
        const html = await response.text();
        assert.ok(html.includes('nonce="' + nonce + '"'));
        assert.ok(html.includes('Let’s start with your brand.'));
        const protectedPage = await fetch('http://127.0.0.1:3000/onboarding', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        assert.equal(protectedPage.status, 307);
        assert.ok(protectedPage.headers.get('location').includes('/auth/login'));
      })().catch(error => { console.error(error.message); process.exit(1); });
    `]);
    if (result.status === 0) { htmlPassed = true; break; }
    if (i === 59) throw new Error(`Web container failed its HTML/session check: ${result.stderr}`);
    await pause();
  }
  assert.ok(htmlPassed);
  report.checks.push('web-production-html-matching-csp-nonce-and-protected-onboarding');
  const authHttp = spawnSync(process.execPath, [path.join(root,'scripts/verify-auth-http-runtime.mjs'),report.images.api.imageId], {
    cwd:root,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:2*1024*1024,
  });
  assert.equal(authHttp.status,0,authHttp.error?.message || authHttp.stderr || authHttp.stdout || 'HTTP authentication fixture failed');
  const authSummary=JSON.parse(authHttp.stdout.trim().split('\n').at(-1));
  assert.equal(authSummary.passed,true);
  const authReportPath=path.resolve(root,authSummary.evidence);
  assert.ok(authReportPath.startsWith(path.join(root,'runtime/launch-evidence')+path.sep));
  const authBytes=fs.readFileSync(authReportPath), authReport=JSON.parse(authBytes);
  assert.equal(authReport.passed,true);
  assert.equal(authReport.images.api.id,report.images.api.imageId);
  assert.equal(authReport.source.commit,report.source.commit);
  // Existing CI retains edge-runtime JSON. Preserve the exact nested bytes in
  // that artifact as well, rather than leaving an orphaned evidence reference.
  report.authHttpFixture={report:path.relative(root,authReportPath),sha256:crypto.createHash('sha256').update(authBytes).digest('hex'),imageId:authReport.images.api.id,checks:authReport.checks,reportJson:authBytes.toString('utf8')};
  report.checks.push('api-real-http-password-recovery-revocation-ownership-and-redis-rate-limits');
  report.passed = true;
  console.log('Web production HTML, CSP nonce and protected onboarding passed without publishing any host port.');
} catch (error) {
  // Never copy a synthetic credential into logs or evidence either.
  report.failure = String(error.message).replaceAll(password, '[redacted]');
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  const cleanup = (args) => {
    if (invoke(args).status === 0) return;
    report.passed = false;
    report.failure = [report.failure, 'Disposable resource cleanup failed; inspect resources carrying drapixai.purpose=disposable-edge-runtime-test.'].filter(Boolean).join(' ');
    process.exitCode = 1;
  };
  if (webCreated) cleanup(['rm', '-f', web]);
  if (databaseCreated) cleanup(['rm', '-fv', database]);
  if (networkCreated) cleanup(['network', 'rm', network]);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: ${path.relative(process.cwd(), reportFile)}`);
}
