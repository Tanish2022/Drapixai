import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const marker = 'synthetic-do-not-log';
const cases = [
  ['missing approval', `redis://:${marker}@127.0.0.1:9`, ''],
  ['remote endpoint', `redis://:${marker}@remote.example.invalid:6379`, 'I_ACKNOWLEDGE_DISPOSABLE_REDIS'],
  ['malformed endpoint', `invalid-${marker}`, 'I_ACKNOWLEDGE_DISPOSABLE_REDIS'],
  ['missing endpoint', '', 'I_ACKNOWLEDGE_DISPOSABLE_REDIS'],
];
for (const [label, url, approval] of cases) {
  test(`distributed test refuses ${label} before connecting`, () => {
    const result = spawnSync(process.execPath, [
      'node_modules/ts-node/dist/bin.js', 'src/scripts/distributed-security-control-tests.ts',
    ], {
      cwd: path.join(root, 'apps/api'), encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { ...process.env, REDIS_URL: url, DRAPIXAI_DISPOSABLE_REDIS_APPROVAL: approval },
    });
    assert.equal(result.error, undefined, 'Target refusal must finish without a connection timeout');
    assert.equal(result.status, 1);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /explicitly approved loopback disposable REDIS_URL/);
    assert.ok(!output.includes(marker), 'Refusal must not expose the supplied endpoint credential');
  });
}
