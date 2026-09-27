import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// All endpoints and credentials are generated here. Never consume an operator's
// database or bucket. Only these new containers and synthetic bytes are changed.
const root = process.cwd();
const runId = `versioned-retention-${crypto.randomBytes(6).toString('hex')}`;
const evidenceDir = path.join(root, 'runtime/launch-evidence', runId);
fs.mkdirSync(evidenceDir, { recursive: true });
const password = crypto.randomBytes(40).toString('hex');
const accessKey = `fixture-${crypto.randomBytes(8).toString('hex')}`;
const database = 'drapixai_retention_test';
const bucket = 'disposable-retention';
const storageDockerfile = path.join(root, 'deploy/test/Dockerfile.minio-test');
assert.ok(fs.existsSync(storageDockerfile), 'The drill requires the reviewed disposable S3 compatibility Dockerfile');
const storageBuildSha256 = crypto.createHash('sha256').update(fs.readFileSync(storageDockerfile)).digest('hex');
const storageImage = `drapixai-retention-minio:${storageBuildSha256.slice(0, 20)}`;
const containers = [];
const checks = [];
const imageIds = {};
const sourcePaths = [
  'apps/api/package-lock.json', 'apps/api/src/lib/storage-erasure.ts',
  'apps/api/src/services/review-retention.ts', 'apps/api/src/scripts/purge-legacy-render-media.ts',
  'apps/api/src/scripts/initialize-storage-bucket.ts', 'scripts/verify-versioned-retention.mjs',
  'deploy/test/Dockerfile.minio-test', 'deploy/staging/.images.env.example',
  ...fs.readdirSync(path.join(root, 'apps/api/prisma/migrations')).sort()
    .filter(entry => fs.existsSync(path.join(root, 'apps/api/prisma/migrations', entry, 'migration.sql')))
    .map(entry => `apps/api/prisma/migrations/${entry}/migration.sql`),
];
const sourceSha256 = Object.fromEntries(sourcePaths.map(source => [source,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex')]));
const redact = value => String(value || '').replaceAll(password, '[REDACTED]').replaceAll(accessKey, '[REDACTED]');
const invoke = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000,
    maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(redact(result.stderr || result.stdout || result.error?.message || 'COMMAND_FAILED'));
  return result.stdout.trim();
};
const docker = (args, options) => invoke('docker', args, options);
const start = (role, args, env) => {
  const id = docker(['run', '-d', '--name', `drapixai-${runId}-${role}`,
    '--label', 'drapixai.purpose=disposable-versioned-retention', ...args], { env: { ...process.env, ...env } });
  assert.match(id, /^[a-f0-9]{64}$/); containers.push(id);
  imageIds[role] = docker(['inspect', '--format', '{{.Image}}', id]); return id;
};
const binding = (id, port) => {
  const value = docker(['port', id, `${port}/tcp`]);
  assert.match(value, /^127\.0\.0\.1:[0-9]+$/); return value;
};
let storage;
let prisma;
let failure = null;
try {
  docker(['build', '--pull=false', '--label', 'drapixai.purpose=disposable-versioned-retention',
    '-f', storageDockerfile, '-t', storageImage, root], { timeout: 900000 });
  imageIds.storageBuild = docker(['image', 'inspect', '--format', '{{.Id}}', storageImage]);
  const db = start('db', ['--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
    '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=${database}`, 'postgres:16-alpine'], { POSTGRES_PASSWORD: password });
  const minio = start('storage', ['--tmpfs', '/data:rw,size=128m', '-p', '127.0.0.1::9000',
    '-e', 'MINIO_ROOT_USER', '-e', 'MINIO_ROOT_PASSWORD', storageImage, 'server', '/data', '--address', ':9000'],
  { MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: password });
  const endpoint = `http://${binding(minio, 9000)}`;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      docker(['exec', db, 'pg_isready', '-U', 'postgres', '-d', database]);
      const response = await fetch(`${endpoint}/minio/health/ready`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Both containers must become ready before any fixture is seeded. */ }
    await delay(500);
  }
  assert.ok(ready, 'Disposable database/storage did not become ready');
  for (const entry of fs.readdirSync(path.join(root, 'apps/api/prisma/migrations')).sort()) {
    const migration = path.join(root, 'apps/api/prisma/migrations', entry, 'migration.sql');
    if (fs.existsSync(migration)) docker(['exec', '-i', db, 'psql', '-X', '-q', '-U', 'postgres', '-d', database,
      '-v', 'ON_ERROR_STOP=1'], { input: fs.readFileSync(migration, 'utf8') });
  }
  const config = {
    NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:${password}@${binding(db, 5432)}/${database}`,
    S3_ENDPOINT: endpoint, S3_BUCKET: bucket, S3_FORCE_PATH_STYLE: '1', AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: accessKey, AWS_SECRET_ACCESS_KEY: password, AWS_SESSION_TOKEN: '', AWS_MAX_ATTEMPTS: '1',
    AWS_EC2_METADATA_DISABLED: 'true', DRAPIXAI_SECRETS_PROVIDER: 'env',
    DRAPIXAI_AUDIT_LOG_SECRET: password, DRAPIXAI_AUDIT_LOG_PREVIOUS_SECRETS: '',
    DRAPIXAI_STORAGE_OBJECT_LOCK_ENABLED: '1',
    DOTENV_CONFIG_PATH: path.join(evidenceDir, 'empty.env'),
  };
  fs.writeFileSync(config.DOTENV_CONFIG_PATH, '# Disposable test; configuration is passed in memory.\n');
  Object.assign(process.env, config);
  const require = createRequire(path.join(root, 'apps/api/package.json'));
  require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json') });
  const sdk = require('@aws-sdk/client-s3');
  const { PrismaClient } = require('@prisma/client');
  const { eraseStoredObjectVersions, listStoredObjectVersions } = require(path.join(root, 'apps/api/src/lib/storage-erasure.ts'));
  const { runTryOnReviewRetention } = require(path.join(root, 'apps/api/src/services/review-retention.ts'));
  const { verifySecurityAuditChain } = require(path.join(root, 'apps/api/src/lib/audit-log.ts'));
  prisma = new PrismaClient();
  storage = new sdk.S3Client({ endpoint, forcePathStyle: true, region: 'us-east-1', maxAttempts: 1,
    credentials: { accessKeyId: accessKey, secretAccessKey: password } });
  const initializer = spawnSync(process.execPath, [path.join(root, 'apps/api/node_modules/ts-node/dist/bin.js'),
    '--project', path.join(root, 'apps/api/tsconfig.json'),
    path.join(root, 'apps/api/src/scripts/initialize-storage-bucket.ts')], { cwd: root, env: { ...process.env, ...config },
    encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.equal(initializer.status, 0, redact(initializer.stderr || initializer.error?.message || initializer.stdout));
  assert.equal((await storage.send(new sdk.GetBucketVersioningCommand({ Bucket: bucket }))).Status, 'Enabled');
  checks.push('the storage initializer creates the disposable bucket with versioning enabled');
  // Force real pagination without generating thousands of disposable objects.
  let versionPages = 0;
  let replaceNullBeforeDelete = false;
  storage.middlewareStack.add((next, context) => async args => {
    if (context.commandName === 'ListObjectVersionsCommand') { args.input.MaxKeys = 2; versionPages++; }
    if (context.commandName === 'DeleteObjectCommand' && replaceNullBeforeDelete) {
      replaceNullBeforeDelete = false;
      await storage.send(new sdk.PutObjectCommand({ Bucket: args.input.Bucket, Key: args.input.Key,
        Body: Buffer.from('replacement with different bytes') }));
    }
    return next(args);
  }, { step: 'initialize', name: 'forceFixturePagination' });
  const put = async (Key, extra = {}, Bucket = bucket) => storage.send(new sdk.PutObjectCommand({
    Bucket, Key, Body: Buffer.from('synthetic fixture; no shopper image'), ...extra,
  }));
  const hidden = async Key => {
    await put(Key); await put(Key); await storage.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key }));
  };
  const user = await prisma.user.create({ data: { email: 'retention-fixture@example.invalid', passwordHash: 'not-a-login' } });
  const key = 'tryon-review/test/person.png';
  await hidden(key);
  const review = await prisma.tryOnResult.create({ data: { userId: user.id, engine: 'synthetic-test', createdAt: new Date(0),
    personImageUrl: `s3://${bucket}/${key}` } });
  const options = { retentionDays: 0, batchSize: 100 };
  assert.equal((await runTryOnReviewRetention(prisma, { ...options, dryRun: true })).imagesDeleted, 0);
  assert.equal((await listStoredObjectVersions(storage, bucket, key)).length, 2);
  const erased = await runTryOnReviewRetention(prisma, options);
  assert.deepEqual(erased.failures, []); assert.equal(erased.imagesDeleted, 1);
  assert.equal((await listStoredObjectVersions(storage, bucket, key)).length, 0);
  assert.equal((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: review.id } })).personImageUrl, null);
  checks.push('real review retention erases hidden versions before clearing a PostgreSQL reference; dry run preserves them');

  await prisma.tryOnResult.update({ where: { id: review.id }, data: { personImageUrl: `s3://${bucket}/${key}` } });
  assert.deepEqual((await runTryOnReviewRetention(prisma, options)).failures, []);
  assert.equal((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: review.id } })).personImageUrl, null);
  checks.push('post-erasure database-reference retry is idempotent');

  const lockedKey = 'tryon-review/locked/person.png';
  await put(lockedKey, { ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: new Date(Date.now() + 600000) });
  const locked = await prisma.tryOnResult.create({ data: { userId: user.id, engine: 'synthetic-test', createdAt: new Date(0),
    personImageUrl: `s3://${bucket}/${lockedKey}` } });
  const denied = await runTryOnReviewRetention(prisma, options);
  assert.equal(denied.failures.length, 1); assert.equal(denied.imagesDeleted, 0);
  assert.equal((await listStoredObjectVersions(storage, bucket, lockedKey)).length, 1);
  assert.ok((await prisma.tryOnResult.findUniqueOrThrow({ where: { id: locked.id } })).personImageUrl);
  checks.push('real Object Lock denial preserves the retained version and database reference, and reports failure');

  for (const state of ['unversioned', 'suspended']) {
    const Bucket = `disposable-${state}`;
    await storage.send(new sdk.CreateBucketCommand({ Bucket }));
    if (state === 'suspended') {
      await storage.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
      await put(key, {}, Bucket);
      await storage.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Suspended' } }));
    }
    await put(key, {}, Bucket);
    await assert.rejects(eraseStoredObjectVersions(storage, Bucket, key), /VERSIONING_REQUIRED/);
    assert.ok((await listStoredObjectVersions(storage, Bucket, key)).length > 0);
    await storage.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }));
    await eraseStoredObjectVersions(storage, Bucket, key);
    assert.equal((await listStoredObjectVersions(storage, Bucket, key)).length, 0);
  }
  checks.push('unversioned and suspended buckets refuse deletion; enabling versioning permits safe erasure of existing null versions');
  // Seed another null version, then enable versioning before a concurrent write.
  await storage.send(new sdk.PutBucketVersioningCommand({ Bucket: 'disposable-unversioned', VersioningConfiguration: { Status: 'Suspended' } }));
  await put(key, {}, 'disposable-unversioned');
  await storage.send(new sdk.PutBucketVersioningCommand({ Bucket: 'disposable-unversioned', VersioningConfiguration: { Status: 'Enabled' } }));
  replaceNullBeforeDelete = true;
  await assert.rejects(eraseStoredObjectVersions(storage, 'disposable-unversioned', key), /VERSIONS_REMAIN/);
  assert.equal((await listStoredObjectVersions(storage, 'disposable-unversioned', key)).length, 1);
  checks.push('concurrent new version survives deletion of the old null version and prevents false erasure success when the S3 compatibility provider ignores If-Match');

  // Test the actual legacy purge CLI, including a hidden orphan with no DB row.
  const apiKey = await prisma.apiKey.create({ data: { userId: user.id, keyHash: crypto.randomBytes(32).toString('hex'), domainWhitelist: 'fixture.example.invalid' } });
  const legacyKey = 'session/fixture/input.png';
  const orphanKey = 'outputs/fixture/orphan.png';
  await hidden(legacyKey); await hidden(orphanKey);
  await put('garments/preserve.png');
  const render = await prisma.render.create({ data: { apiKeyId: apiKey.id, inputUrl: `s3://${bucket}/${legacyKey}` } });
  const purge = (confirmed, expectedExit = 0) => {
    const result = spawnSync(process.execPath, [path.join(root, 'apps/api/node_modules/ts-node/dist/bin.js'),
      '--project', path.join(root, 'apps/api/tsconfig.json'), path.join(root, 'apps/api/src/scripts/purge-legacy-render-media.ts'),
      ...(confirmed ? ['--confirm'] : [])], { cwd: root, env: { ...process.env, ...config },
      encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.equal(result.status, expectedExit, redact(result.stderr || result.error?.message || result.stdout));
    return result.stdout.trim();
  };
  const dry = purge(false);
  assert.match(dry, /"legacyVersionsScanned": 4/);
  assert.ok((await prisma.render.findUniqueOrThrow({ where: { id: render.id } })).inputUrl);
  assert.equal((await listStoredObjectVersions(storage, bucket, orphanKey)).length, 2);
  const confirmed = JSON.parse(purge(true));
  assert.equal(confirmed.failures, 0); assert.equal(confirmed.renderReferencesCleared, 1);
  assert.equal((await prisma.render.findUniqueOrThrow({ where: { id: render.id } })).inputUrl, null);
  assert.equal((await listStoredObjectVersions(storage, bucket, 'session/')).length, 0);
  assert.equal((await listStoredObjectVersions(storage, bucket, 'outputs/')).length, 0);
  assert.equal((await listStoredObjectVersions(storage, bucket, 'garments/')).length, 1);
  assert.equal(JSON.parse(purge(true)).failures, 0);
  checks.push('actual legacy purge CLI previews historical media, erases referenced and orphaned versions, preserves garment assets and retries safely');
  const lockedLegacy = 'session/locked/input.png';
  await put(lockedLegacy, { ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: new Date(Date.now() + 600000) });
  await prisma.render.update({ where: { id: render.id }, data: { inputUrl: `s3://${bucket}/${lockedLegacy}` } });
  assert.ok(JSON.parse(purge(true, 2)).failures > 0);
  assert.ok((await prisma.render.findUniqueOrThrow({ where: { id: render.id } })).inputUrl);
  assert.equal((await listStoredObjectVersions(storage, bucket, lockedLegacy)).length, 1);
  assert.equal((await prisma.securityAuditLog.findFirstOrThrow({ orderBy: { id: 'desc' } })).outcome, 'failure');
  checks.push('legacy CLI exits nonzero and preserves the reference and failure audit when Object Lock prevents erasure');
  assert.ok(versionPages > 10, 'Real version pagination must be exercised');
  const chain = await verifySecurityAuditChain(prisma);
  assert.ok(chain.valid); assert.ok(chain.checked >= 5);
  checks.push('real deletion outcomes are appended to a valid PostgreSQL audit chain');
} catch (error) {
  failure = redact(error instanceof Error ? error.message : 'RETENTION_DRILL_FAILED');
} finally {
  storage?.destroy();
  try { await prisma?.$disconnect(); } catch (error) { failure ||= redact(error.message); }
  for (const id of containers.reverse()) {
    try { docker(['rm', '-f', '-v', id]); } catch (error) { failure ||= redact(error.message); }
  }
}
const report = { releaseCommit: invoke('git', ['rev-parse', 'HEAD']),
  dirtyCheckout: Boolean(invoke('git', ['status', '--porcelain'])),
  sourceSha256, imageIds,
  scope: 'disposable local PostgreSQL and S3 compatibility provider, synthetic fixtures only; not live retention certification',
  passed: !failure, checks, failure };
fs.writeFileSync(path.join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
