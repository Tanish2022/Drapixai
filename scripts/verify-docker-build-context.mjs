import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const evidenceRoot = path.join(root, 'runtime', 'launch-evidence');
fs.mkdirSync(evidenceRoot, { recursive: true });
const work = fs.mkdtempSync(path.join(evidenceRoot, 'docker-context-'));
const context = path.join(work, 'context');
const output = path.join(work, 'export');
fs.mkdirSync(context);

// Synthetic files only: never copy a real credential, customer asset or weight.
const excluded = [
  '.env', 'apps/api/.env', 'apps/web/.env.production',
  'deploy/env/api.production.env', 'deploy/env/api.staging.env',
  'deploy/env/api.sandbox.env', 'deploy/env/web.staging.env',
  'deploy/staging/private/drapixai-api.json',
  'deploy/staging/private/operator.example', 'deploy/private/production.json',
  'deploy/staging/certification.env', 'deploy/staging/.images.env',
  'deploy/workstation/private/server.key', 'deploy/workstation/private/ca.pem',
  'nested/credential.p12', 'nested/credential.pfx', 'nested/.ssh/id_ed25519',
  'models/catvton/weights.safetensors', 'nested/weights.safetensors',
  'drapixai_ai/.hf_cache/token', 'drapixai_ai/garments/customer.png',
  'drapixai_ai/runtime/person.png', 'drapixai_ai/outputs/preview.png',
  'drapixai_ai/third_party/CatVTON/.git/config',
  'runtime/person.png', 'uploads/person.png', 'apps/api/uploads/person.png',
  'logs/request.log', 'node_modules/dependency/index.js',
  'apps/web/node_modules/dependency/index.js', 'apps/web/.next/server.js',
  'runpod_test.env', 'drapixai_runpod_test.tar',
];
const retained = [
  'apps/api/package.json', 'apps/api/package-lock.json', 'apps/api/src/bootstrap.ts',
  'apps/web/public/approved-tryon.png', 'apps/web/app/page.tsx',
  'drapixai_ai/engines/catvton.py', 'drapixai_ai/requirements.rtx-pro-6000.txt',
  'drapixai_ai/third_party/CatVTON/model/pipeline.py', 'drapixai_ai/third_party/CatVTON/LICENSE',
  'deploy/release/standard-catvton-rc1.env', 'deploy/runpod/start-ai-api.sh',
  'deploy/env/api.staging.example', 'deploy/staging/certification.env.example',
  'deploy/staging/.images.env.example', 'apps/api/.env.example',
];
const ignore = fs.readFileSync(path.join(root, '.dockerignore'));
fs.writeFileSync(path.join(context, '.dockerignore'), ignore);
fs.writeFileSync(path.join(context, 'Dockerfile'), 'FROM scratch\nCOPY . /context/\n');
for (const filename of [...excluded, ...retained]) {
  const target = path.join(context, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'SYNTHETIC_BUILD_CONTEXT_PROBE\n');
}

let failure = null;
let leaked = [];
let missing = [];
try {
  for (const dockerfile of ['apps/api/Dockerfile', 'apps/web/Dockerfile',
                            'drapixai_ai/docker/Dockerfile', 'drapixai_ai/docker/Dockerfile.lower-body']) {
    assert.equal(fs.existsSync(path.join(root, `${dockerfile}.dockerignore`)), false,
      `Dockerfile-specific ignore rules require their own context certification: ${dockerfile}.dockerignore`);
  }
  // Docker's own matcher is authoritative; there is no custom glob emulation.
  const build = spawnSync('docker', [
    'buildx', 'build', '--network=none', '--no-cache',
    '--output', `type=local,dest=${output}`, context,
  ], { cwd: root, encoding: 'utf8', timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(build.status, 0, `Synthetic Docker context build failed: ${build.error?.code || build.stderr?.slice(-1500)}`);
  leaked = excluded.filter((filename) => fs.existsSync(path.join(output, 'context', filename)));
  missing = retained.filter((filename) => !fs.existsSync(path.join(output, 'context', filename)));
  assert.deepEqual(leaked, [], `Sensitive paths reached COPY context: ${leaked.join(', ')}`);
  assert.deepEqual(missing, [], `Required application/profile paths were excluded: ${missing.join(', ')}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  for (const directory of [context, output]) {
    if (!fs.existsSync(directory)) continue;
    const relative = path.relative(fs.realpathSync(work), fs.realpathSync(directory));
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
const git = (args) => spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
const head = git(['rev-parse', 'HEAD']);
const status = git(['status', '--porcelain']);
const report = {
  scope: 'synthetic-docker-build-context-not-production-image-scan',
  passed: !failure, releaseCommit: head.status === 0 ? head.stdout.trim() : null,
  dirtyEntries: status.status === 0 ? status.stdout.split(/\r?\n/).filter(Boolean).length : null,
  generatedAt: new Date().toISOString(),
  dockerignoreSha256: crypto.createHash('sha256').update(ignore).digest('hex'),
  excludedProbeCount: excluded.length, retainedProbeCount: retained.length,
  leakedPaths: leaked, missingPaths: missing, failure,
};
const reportPath = path.join(work, 'report.json');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Evidence: ${path.relative(root, reportPath)}`);
if (failure) process.exitCode = 1;
