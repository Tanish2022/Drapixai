import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// This drill creates its own no-network, no-host-port PostgreSQL container.
// It never consumes DATABASE_URL or operator restore approvals from the host.
const root = process.cwd();
const runId = `restore-${crypto.randomBytes(6).toString('hex')}`;
const name = `drapixai-p0-${runId}`;
const evidenceDir = path.join(root, 'runtime', 'launch-evidence', runId);
fs.mkdirSync(evidenceDir, { recursive: true });
const password = crypto.randomBytes(48).toString('base64url');
const database = 'drapixai_restore_test';
const inputs = [
  'deploy/scripts/restore-postgres-backup.sh',
  ...fs.readdirSync(path.join(root, 'apps/api/prisma/migrations'))
    .filter((entry) => fs.statSync(path.join(root, 'apps/api/prisma/migrations', entry)).isDirectory())
    .sort().map((entry) => `apps/api/prisma/migrations/${entry}/migration.sql`),
];
const checks = [];
const redact = (value) => String(value || '').replaceAll(password, '[REDACTED]');
const invoke = (args, options = {}) => {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  return { status: result.status, error: result.error?.message, output: redact(`${result.stdout || ''}\n${result.stderr || ''}`).trim() };
};
const docker = (args, options) => {
  const result = invoke(args, options);
  assert.equal(result.status, 0, result.output || result.error || 'Docker command failed');
  return result.output;
};
const sqlArgs = ['exec', '-i', name, 'psql', '-X', '-q', '-t', '-A', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'];
const sql = (input) => docker(sqlArgs, { input });
const snapshot = () => sql(`
  SELECT json_agg(t ORDER BY id) FROM "User" t;
  SELECT json_agg(t ORDER BY id) FROM "ApiKey" t;
  SELECT json_agg(t ORDER BY id) FROM "SecurityAuditLog" t;
  SELECT json_agg(t ORDER BY id) FROM restore_probe t;
  SELECT last_value FROM "User_id_seq";
`);
const restore = (overrides = {}, backup = '/tmp/recovery.dump') => {
  const config = {
    DATABASE_URL: `postgresql://postgres@127.0.0.1:5432/${database}`,
    PGPASSWORD: password,
    DRAPIXAI_DEPLOY_ENV: 'sandbox',
    DRAPIXAI_EXPECTED_DATABASE_NAME: database,
    DRAPIXAI_RESTORE_APPROVAL_ID: `disposable-${runId}`,
    DRAPIXAI_RESTORE_CONFIRMATION: 'RESTORE_SANDBOX',
    ...overrides,
  };
  return invoke(['exec', ...Object.keys(config).flatMap((key) => ['-e', key]), name, 'bash', '/opt/restore.sh', backup], {
    env: { ...process.env, ...config },
  });
};
const rejected = (result, expected) => {
  assert.notEqual(result.status, 0, 'Unsafe restore unexpectedly succeeded');
  assert.match(result.output, expected);
};
let created = false;
let failure = null;
let restoreDurationMs = null;
try {
  docker(['run', '-d', '--name', name, '--network', 'none',
    '--label', 'drapixai.purpose=disposable-recovery-drill',
    '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=${database}`,
    '--mount', `type=bind,src=${path.join(root, inputs[0])},dst=/opt/restore.sh,readonly`,
    'postgres:16-bookworm'], { env: { ...process.env, POSTGRES_PASSWORD: password } });
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (invoke(['exec', name, 'pg_isready', '-U', 'postgres', '-d', database]).status === 0) { ready = true; break; }
    await delay(1000);
  }
  assert.ok(ready, 'Disposable PostgreSQL must become ready');
  for (const input of inputs.slice(1)) sql(fs.readFileSync(path.join(root, input), 'utf8'));
  sql(`
    INSERT INTO "User" (email, "passwordHash", "companyName") VALUES
      ('restore-a@example.invalid', 'synthetic-not-a-login', 'backup tenant A'),
      ('restore-b@example.invalid', 'synthetic-not-a-login', 'backup tenant B');
    INSERT INTO "ApiKey" ("userId", "keyHash", "domainWhitelist", kind) VALUES
      (1, 'synthetic-hash-a', 'tenant-a.example.invalid', 'manual'),
      (2, 'synthetic-hash-b', 'tenant-b.example.invalid', 'manual');
    INSERT INTO "SecurityAuditLog" ("actorRole", action, "previousHash", "entryHash")
      VALUES ('test-fixture', 'restore.synthetic', 'synthetic-previous', 'synthetic-entry');
    CREATE TABLE restore_probe (id integer PRIMARY KEY, payload text NOT NULL);
    INSERT INTO restore_probe VALUES (1, 'backup data');
  `);
  const backupSnapshot = snapshot();
  docker(['exec', name, 'pg_dump', '-U', 'postgres', '-d', database, '--format=custom', '--no-owner', '--no-acl', '--file=/tmp/recovery.dump']);
  docker(['exec', name, 'pg_restore', '--list', '/tmp/recovery.dump']);
  checks.push('custom-format backup created from all release SQL migrations and synthetic two-tenant data');
  sql(`UPDATE "User" SET "companyName" = 'current data must survive failure' WHERE id = 1;
       INSERT INTO restore_probe VALUES (2, 'post-backup data must survive failure');
       ALTER TABLE restore_probe ADD COLUMN newer_state text DEFAULT 'post-backup schema';
       SELECT setval('"User_id_seq"', 42, true);`);
  const before = snapshot();
  for (const [config, message] of [
    [{ DRAPIXAI_EXPECTED_DATABASE_NAME: 'wrong_database' }, /does not match/],
    [{ DRAPIXAI_RESTORE_CONFIRMATION: '' }, /Restore is destructive/],
    [{ DRAPIXAI_RESTORE_APPROVAL_ID: '' }, /approval reference/],
    [{ DRAPIXAI_DEPLOY_ENV: 'development' }, /sandbox, staging, or production/],
  ]) {
    rejected(restore(config), message);
    assert.equal(snapshot(), before, 'Rejected restore must not change current data');
  }
  checks.push('wrong database, missing approval, missing confirmation and invalid environment rejected without mutation');
  docker(['exec', name, 'bash', '-c', "printf 'invalid backup' > /tmp/invalid.dump"]);
  rejected(restore({}, '/tmp/invalid.dump'), /pg_restore:/);
  assert.equal(snapshot(), before, 'Invalid backup must not change current data');
  checks.push('invalid backup rejected without mutation');

  // Inject a deterministic error in the post-data phase, after pg_restore has
  // dropped/recreated tables and copied rows. Exit-on-error alone is insufficient.
  sql(`
    CREATE FUNCTION fail_restore_index() RETURNS event_trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'SYNTHETIC_RESTORE_INDEX_FAILURE'; END; $$;
    CREATE EVENT TRIGGER fail_restore_index ON ddl_command_start
      WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION fail_restore_index();
  `);
  const failedRestore = restore();
  fs.writeFileSync(path.join(evidenceDir, 'injected-failure.log'), `${failedRestore.output}\n`);
  rejected(failedRestore, /SYNTHETIC_RESTORE_INDEX_FAILURE/);
  assert.equal(snapshot(), before, 'Failed restore must roll back all changes to current tenant data, audit records and sequences');
  sql('DROP EVENT TRIGGER fail_restore_index; DROP FUNCTION fail_restore_index();');
  checks.push('late restore failure rolls back table, tenant data, audit record and sequence changes');

  const start = Date.now();
  const success = restore();
  restoreDurationMs = Date.now() - start;
  fs.writeFileSync(path.join(evidenceDir, 'successful-restore.log'), `${success.output}\n`);
  assert.equal(success.status, 0, success.output);
  assert.equal(snapshot(), backupSnapshot, 'Successful restore must reproduce the saved tenant data and sequences');
  for (const statement of [
    'UPDATE "SecurityAuditLog" SET outcome = \'tampered\';',
    'DELETE FROM "SecurityAuditLog";',
    'TRUNCATE TABLE "SecurityAuditLog";',
  ]) rejected(invoke(sqlArgs, { input: statement }), /SecurityAuditLog is append-only/);
  assert.equal(snapshot(), backupSnapshot);
  checks.push('successful restore reproduces backup; immutable audit UPDATE, DELETE and TRUNCATE protection survives');
} catch (error) {
  failure = redact(error instanceof Error ? error.message : error);
} finally {
  if (created) {
    try { docker(['rm', '-f', '-v', name]); checks.push('own disposable container and volumes removed'); }
    catch (error) { failure = `${failure || ''}\nCleanup failed: ${redact(error.message)}`.trim(); }
  }
}
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', windowsHide: true });
const report = {
  scope: 'local-disposable-recovery-not-staging-or-production-certification',
  releaseCommit: head.status === 0 ? head.stdout.trim() : null,
  dirtyEntries: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : null,
  generatedAt: new Date().toISOString(), passed: !failure, checks, restoreDurationMs, failure,
  sourceSha256: Object.fromEntries(['scripts/verify-postgres-restore.mjs', ...inputs].map((input) => [input, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, input))).digest('hex')])),
};
fs.writeFileSync(path.join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Evidence: ${path.relative(root, evidenceDir)}`);
if (failure) process.exitCode = 1;
