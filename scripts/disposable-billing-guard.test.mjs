import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const marker = 'synthetic-do-not-log-billing-credential';
const approval = 'I_ACKNOWLEDGE_DISPOSABLE_DATABASE';
for (const [label, url, consent] of [
  ['missing URL', '', approval],
  ['missing approval', `postgresql://user:${marker}@127.0.0.1:9/disposable_test`, ''],
  ['ordinary local application database', `postgresql://user:${marker}@127.0.0.1:9/drapixai`, approval],
  ['remote test endpoint', `postgresql://user:${marker}@remote.example.invalid:9/disposable_test`, approval],
  ['invalid URL', `invalid-${marker}`, approval],
  ['wrong protocol', `https://user:${marker}@127.0.0.1:9/disposable_test`, approval],
  ['endpoint override', `postgresql://user:${marker}@127.0.0.1:9/disposable_test?host=remote.example.invalid`, approval],
  ['encoded path separator', `postgresql://user:${marker}@127.0.0.1:9/disposable_test%2Fother`, approval],
]) {
  test(`billing database test refuses ${label} before connecting`, () => {
    const result = spawnSync(process.execPath, [
      'node_modules/ts-node/dist/bin.js', 'src/scripts/billing-database-tests.ts',
    ], {
      cwd: path.join(process.cwd(), 'apps/api'), encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { ...process.env, DATABASE_URL: url, DRAPIXAI_DISPOSABLE_DB_APPROVAL: consent },
    });
    assert.equal(result.error, undefined, 'Target refusal must finish without a connection timeout');
    assert.equal(result.status, 1);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /explicitly approved loopback disposable DATABASE_URL/);
    assert.ok(!output.includes(marker), 'Target refusal must not expose endpoint credentials');
  });
}
