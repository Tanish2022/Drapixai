import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./launch-gate-report.mjs', import.meta.url));

test('help and invalid options never read a project or launch a gate', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'drapixai-gate-cli-'));
  try {
    // There is deliberately no manifest here. Reaching config loading or any
    // gate process would fail this boundary, rather than touch a real project.
    for (const flag of ['--help', '-h']) {
      const result = spawnSync(process.execPath, [script, flag], { cwd, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^Usage:/);
      assert.equal(result.stderr, '');
    }
    for (const args of [
      ['--scpoe=repository'], ['--scope=repository=ignored'], ['--scope=unknown'],
      ['--scope='], ['--evidence='], ['--scope', 'repository'],
      ['--scope=all', '--scope=repository'], ['--evidence=a', '--evidence=b'],
      ['--help', '--scope=all'], ['unexpected-positional-argument'],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
      assert.match(result.stderr, /^Usage:/);
      assert.equal(result.stdout, '');
    }
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    const resolved = fs.realpathSync(cwd);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('drapixai-gate-cli-'));
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
