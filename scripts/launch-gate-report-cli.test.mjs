import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { npmInvocation } from './lib/npm-invocation.mjs';

const script = fileURLToPath(new URL('./launch-gate-report.mjs', import.meta.url));

test('npm runs under the verifier Node and treats shell-shaped arguments as literal data', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'drapixai-npm runtime-'));
  try {
    const cli = path.join(cwd, 'npm-cli.js');
    fs.writeFileSync(cli, 'console.log(JSON.stringify({node:process.execPath,args:process.argv.slice(2)}))');
    const args = ['--prefix', 'path with spaces', 'audit', 'literal&echo=untrusted', '$(untrusted)'];
    const invocation = npmInvocation(args, { env: { DRAPIXAI_NPM_CLI: cli, PATH: '' } });
    assert.equal(invocation.command, process.execPath);
    assert.deepEqual(invocation.args, [fs.realpathSync(cli), ...args]);
    const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { node: process.execPath, args });
    for (const value of ['npm-cli.js', path.join(cwd, 'missing', 'npm-cli.js'), path.join(cwd, 'other.js')]) {
      assert.throws(() => npmInvocation([], { env: { DRAPIXAI_NPM_CLI: value } }), /NPM_CLI_PATH_INVALID/);
    }
    const bin = path.join(cwd, 'bin');
    const fallback = path.join(bin, 'node_modules/npm/bin/npm-cli.js');
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    fs.writeFileSync(fallback, '// synthetic installed CLI');
    assert.equal(npmInvocation([], { env: { PATH: bin }, execPath: path.join(cwd, 'unrelated', 'node') }).args[0], fs.realpathSync(fallback));
  } finally {
    assert.equal(path.dirname(fs.realpathSync(cwd)), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(cwd).startsWith('drapixai-npm runtime-'));
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

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
