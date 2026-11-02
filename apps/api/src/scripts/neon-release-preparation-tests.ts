import assert from 'node:assert/strict';
import { spawnSync, type execFileSync } from 'node:child_process';
import path from 'node:path';
import { inspectNeonMigrationHistory } from '../lib/neon-migration-history';
import { NEON_STAGING } from '../lib/neon-staging';

const syntheticUrl = `postgresql://${NEON_STAGING.migrationRole}:synthetic-only@${NEON_STAGING.host}/${NEON_STAGING.database}?sslmode=require`;
let calls = 0;
const execute = ((exe: string, args: string[], options: any) => {
  calls++;
  assert.equal(exe, process.execPath);
  assert.equal(args.length, 1); assert.ok(args[0].endsWith('verify-migration-history.mjs'));
  assert.ok(!args.join(' ').includes('synthetic-only'));
  assert.equal(options.env.DATABASE_URL, syntheticUrl);
  assert.equal(options.env.SMTP_PASS, undefined); assert.equal(options.env.NODE_OPTIONS, undefined);
  assert.equal(options.timeout, 60_000); assert.equal(options.maxBuffer, 1024 * 1024);
  return JSON.stringify({ appliedCount: 12, pendingCount: 3, pendingMigrations: ['one','two','three'], localChecksums: [] });
}) as typeof execFileSync;
assert.equal(inspectNeonMigrationHistory(syntheticUrl, execute).pendingCount, 3); assert.equal(calls, 1);
console.log('PASS Neon plan reuses the canonical read-only inspector with bounded output, private URL and a restricted child environment');
assert.throws(() => inspectNeonMigrationHistory(syntheticUrl, (() => { throw new Error('synthetic-history-refusal'); }) as typeof execFileSync), /synthetic-history-refusal/);
console.log('PASS Canonical ledger refusal stops planning instead of reporting a successful release');
const child = spawnSync(process.execPath, [require.resolve('ts-node/dist/bin.js'), '--files', path.join(__dirname, 'manage-neon-staging-database.ts')], {
  input: JSON.stringify({ action: 'Migrate', url: syntheticUrl }), encoding: 'utf8', timeout: 30_000,
});
assert.equal(child.status, 1); assert.equal(child.stdout, '');
assert.match(child.stderr, /^NEON_STAGING_OPERATOR_FAILED phase=reviewed-backup-release-workflow-required code=REDACTED sqlstate=REDACTED\r?\n$/);
assert.ok(!child.stderr.includes('synthetic-only'));
console.log('PASS Legacy Windows migration shortcut refuses before connecting; the reviewed backup/exact-release workflow is required');
console.log('Neon release preparation checks passed: 3 groups. Synthetic input only; no live database or network.');
