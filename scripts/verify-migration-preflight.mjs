import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readMigrationFiles, verifyMigrationHistory, inspectMigrationHistory } from '../deploy/scripts/verify-migration-history.mjs';

// Own newly created PostgreSQL only. Never read host DATABASE_URL or approvals.
const root = process.cwd(), id = crypto.randomBytes(8).toString('hex');
const out = path.join(root, 'runtime/launch-evidence', `migration-preflight-${id}`);
fs.mkdirSync(out, { recursive: true });
const password = crypto.randomBytes(32).toString('hex'), name = `drapixai-migration-preflight-${id}`;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|systemroot|windir|comspec|temp|tmp|localappdata|appdata|userprofile|programfiles|programdata|pathext)$/i.test(key)));
const run = (exe, args, options = {}) => spawnSync(exe, args, { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 60000, ...options });
const docker = (args, options) => run('docker', args, options);
const must = result => { assert.equal(result.status, 0, 'OWNED_FIXTURE_COMMAND_FAILED'); return result.stdout.trim(); };
const report = { passed: false, scope: 'Actual migration-ledger guard and Prisma CLI on newly owned PostgreSQL; not live migration or off-host backup qualification', checks: [] };
const local = readMigrationFiles();
const image = 'postgres@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4';
let cid, prisma;
try {
  const good = local.map(row => ({ ...row, finishedAt: new Date(), rolledBackAt: null }));
  assert.equal(verifyMigrationHistory(local, good).pendingCount, 0);
  assert.equal(verifyMigrationHistory(local, good.slice(0, -1)).pendingCount, 1);
  for (const bad of [[{ ...good[0], finishedAt: null }], [{ ...good[0], checksum: '0'.repeat(64) }], [good[1]],
    [...good, good[0]], [{ ...good[0], name: 'unknown' }]]) assert.throws(() => verifyMigrationHistory(local, bad));
  assert.equal(verifyMigrationHistory(local, [{ ...good[0], finishedAt: null, rolledBackAt: new Date() }]).pendingCount, local.length);
  report.checks.push('Complete/pending/rolled-back histories accepted; failed, changed, skipped, duplicate and unknown histories reject');
  if (docker(['image', 'inspect', image]).status !== 0) must(docker(['pull', image], { timeout: 180000 }));
  cid = must(docker(['run', '--pull=never', '-d', '--name', name, '--label', 'drapixai.purpose=disposable-migration-preflight',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=drapixai_migration_test',
    image], { env: { ...env, POSTGRES_PASSWORD: password } }));
  assert.match(cid, /^[a-f0-9]{64}$/);
  let ready = false;
  for (let i = 0; i < 40; i++) { const result = docker(['exec', cid, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'drapixai_migration_test', '-t', '-A', '-c', 'SELECT 1']); if (result.status === 0 && result.stdout.trim() === '1') { ready = true; break; } await delay(250); }
  assert.ok(ready);
  const address = must(docker(['port', cid, '5432/tcp'])); assert.match(address, /^127\.0\.0\.1:\d+$/);
  const url = `postgresql://postgres:${password}@${address}/drapixai_migration_test`;
  const require = createRequire(path.join(root, 'apps/api/package.json'));
  const { PrismaClient } = require('@prisma/client'); prisma = new PrismaClient({ datasources: { db: { url } } });
  assert.equal((await inspectMigrationHistory(prisma)).pendingCount, local.length);
  await prisma.$executeRaw`CREATE TABLE public.unbaselined_fixture (id integer)`;
  await assert.rejects(inspectMigrationHistory(prisma), /BASELINE/);
  await prisma.$executeRaw`DROP TABLE public.unbaselined_fixture`;
  report.checks.push('Empty database permits initial migrations; existing unbaselined tables reject');
  const cli = path.join(root, 'apps/api/node_modules/prisma/build/index.js');
  const cliEnv = { ...env, DATABASE_URL: url, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
  const before = run(process.execPath, [cli, 'migrate', 'status', '--schema', 'apps/api/prisma/schema.prisma'], { env: cliEnv });
  assert.equal(before.status, 1);
  report.checks.push('Actual installed Prisma CLI reports exit 1 for the valid initially pending state');
  must(run(process.execPath, [cli, 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { env: cliEnv }));
  assert.equal((await inspectMigrationHistory(prisma)).pendingCount, 0);
  must(run(process.execPath, [cli, 'migrate', 'status', '--schema', 'apps/api/prisma/schema.prisma'], { env: cliEnv }));
  report.checks.push('Actual Prisma deploy applies all release migrations; ledger hashes and post-status pass');
  for (const field of ['checksum', 'finished_at', 'migration_name']) {
    const rollback = new Error('OWNED_METADATA_ROLLBACK');
    try {
      await prisma.$transaction(async tx => {
        if (field === 'checksum') await tx.$executeRaw`UPDATE public._prisma_migrations SET checksum = ${'0'.repeat(64)}`;
        if (field === 'finished_at') await tx.$executeRaw`UPDATE public._prisma_migrations SET finished_at = NULL`;
        if (field === 'migration_name') await tx.$executeRaw`UPDATE public._prisma_migrations SET migration_name = 'unknown'`;
        await assert.rejects(inspectMigrationHistory(tx)); throw rollback;
      });
    } catch (error) { assert.equal(error, rollback); }
    assert.equal((await inspectMigrationHistory(prisma)).pendingCount, 0);
  }
  report.checks.push('Real failed/checksum/unknown ledger changes reject; test transactions roll back without touching source migrations');
  report.passed = true;
} catch (error) { report.failure = error.code || 'MIGRATION_PREFLIGHT_TEST_FAILED'; process.exitCode = 1; }
finally {
  try { await prisma?.$disconnect(); } catch { report.passed = false; report.failure = 'OWNED_DATABASE_DISCONNECT_FAILED'; process.exitCode = 1; }
  if (cid) { report.ownedFixtureRemoved = docker(['rm', '-fv', cid]).status === 0; if (!report.ownedFixtureRemoved) { report.passed = false; process.exitCode = 1; } }
  report.sourceSha256 = Object.fromEntries(['scripts/verify-migration-preflight.mjs', 'deploy/scripts/verify-migration-history.mjs', 'deploy/scripts/migrate-with-evidence.sh', ...local.map(row => `apps/api/prisma/migrations/${row.name}/migration.sql`)].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, evidence: path.relative(root, path.join(out, 'report.json')), failure: report.failure }));
}
