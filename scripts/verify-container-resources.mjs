import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = crypto.randomBytes(8).toString('hex');
const out = path.join(root, 'runtime/launch-evidence', `container-resources-${id}`);
const mirror = path.join(out, 'compose');
fs.mkdirSync(mirror, { recursive: true });
const emptyEnv = path.join(mirror, 'empty.env');
fs.writeFileSync(emptyEnv, '');
const sources = [
  'deploy/docker-compose.edge.yml', 'deploy/docker-compose.ai.yml',
  'deploy/staging/docker-compose.edge.yml', 'deploy/staging/docker-compose.ai.yml',
  'deploy/staging/docker-compose.neon-cpu.yml', 'deploy/release/standard-catvton-rc1.env',
  'deploy/scripts/private-redis.sh',
];
const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE',
  'LOCALAPPDATA', 'APPDATA', 'ProgramFiles', 'ProgramData', 'ComSpec', 'DOCKER_CONFIG']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {
  DRAPIXAI_REDIS_PASSWORD: 'synthetic-resource-fixture-password',
  DRAPIXAI_INTERNAL_TLS_SECRETS_DIR: mirror,
  DRAPIXAI_TRYON_INTAKE_ENABLED: '0',
  ...Object.fromEntries(['API_RELEASE', 'WEB_RELEASE', 'AI_RELEASE', 'POSTGRES', 'REDIS']
    .map(role => [`DRAPIXAI_${role}_IMAGE`, `fixture.invalid/${role.toLowerCase()}@sha256:${'a'.repeat(64)}`])),
});
const report = {
  passed: false, checks: [], budgets: {}, sourceSha256: {},
  scope: 'Rendered Compose templates and bounded local cgroup/OOM fixtures; no deployment, inference or workstation performance certification',
};
const label = `drapixai.resource-fixture=${id}`;
const ownedContainers = [];
const run = (args, options = {}) => spawnSync('docker', args, {
  cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, ...options,
});
const docker = (args, options) => {
  const result = run(args, options);
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
};
const pass = message => report.checks.push(message);
const get = port => new Promise((resolve, reject) => {
  const req = http.get({ host: '127.0.0.1', port, signal: AbortSignal.timeout(5000) }, response => {
    response.resume();
    response.on('error', reject);
    response.on('end', () => resolve(response.statusCode));
  });
  req.on('error', reject);
});
const limits = { cpus: 0.5, memory: 128 * 1024 * 1024, pids: 64 };
try {
  for (const source of sources) {
    const bytes = fs.readFileSync(path.join(root, source));
    report.sourceSha256[source] = crypto.createHash('sha256').update(bytes).digest('hex');
    const target = path.join(mirror, source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  // Mirror only reviewed source and empty env files. Compose never reads operator secrets.
  for (const environment of ['production', 'staging']) for (const service of ['api', 'web', 'ai']) {
    const target = path.join(mirror, `deploy/env/${service}.${environment}.env`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '');
  }
  const render = (...files) => JSON.parse(docker(['compose', '--env-file', emptyEnv,
    ...files.flatMap(file => ['-f', path.join(mirror, file)]), 'config', '--no-env-resolution', '--format', 'json']));
  const documents = sources.slice(0, 4).map(file => [file, render(file)]);
  let cpuTotal = 0, memoryTotal = 0;
  for (const [file, config] of documents) {
    let cpus = 0, memory = 0;
    for (const [name, service] of Object.entries(config.services)) {
      assert.ok(Number(service.cpus) > 0 && Number(service.cpus) <= 12, `${file}/${name} CPU cap`);
      assert.ok(Number(service.mem_limit) >= 1024 ** 3 && Number(service.mem_limit) <= 96 * 1024 ** 3, `${file}/${name} RAM cap`);
      assert.equal(service.memswap_limit, service.mem_limit, `${file}/${name} swap disabled`);
      assert.ok(service.pids_limit >= 128 && service.pids_limit <= 1024, `${file}/${name} process cap`);
      assert.ok(service.oom_kill_disable !== true);
      if (name === 'redis') {
        const redisBytes = Number(service.environment.DRAPIXAI_REDIS_MAXMEMORY_MB) * 1024 ** 2;
        assert.ok(redisBytes > 0 && redisBytes <= service.mem_limit * 0.75, 'Redis overhead headroom');
      }
      cpus += Number(service.cpus);
      memory += Number(service.mem_limit);
    }
    report.budgets[file] = { cpus, memoryGiB: memory / 1024 ** 3 };
    cpuTotal += cpus; memoryTotal += memory;
  }
  assert.equal(cpuTotal, 33.5);
  assert.equal(memoryTotal / 1024 ** 3, 212);
  const cpuStage = render(sources[2], sources[4]);
  assert.deepEqual(Object.keys(cpuStage.services).sort(), ['api', 'redis', 'web']);
  assert.ok(Object.values(cpuStage.services).every(service => service.mem_limit && service.cpus && service.pids_limit));
  assert.equal(cpuStage.services.api.environment.DRAPIXAI_TRYON_INTAKE_ENABLED, '0');
  pass('All production/staging services and the Neon CPU override retain CPU, RAM, swap and process limits');
  pass('Combined one-replica ceilings total 33.5 CPU equivalents and 212 GiB, with Redis overhead headroom');

  const imageRef = 'node:22-trixie-slim@sha256:2117f713a417f3aff682ac8f5bc2ebbdf1beed51f36e67ab1e0fd3866b6d2d8f';
  const image = JSON.parse(docker(['image', 'inspect', imageRef]))[0];
  report.probeImageRef = imageRef;
  report.probeImage = image.Id;
  assert.equal(docker(['info', '--format', '{{.CgroupVersion}}']), '2', 'The runtime fixture requires cgroup v2');
  const createProbe = (name, code, publish = false) => {
    docker(['create', '--name', name, '--label', label, '--cpus', String(limits.cpus),
      '--memory', String(limits.memory), '--memory-swap', String(limits.memory), '--pids-limit', String(limits.pids),
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', 'node',
      ...(publish ? ['-p', '127.0.0.1::8000'] : ['--network', 'none']),
      '--entrypoint', 'node', image.Id, '-e', code]);
    ownedContainers.push(name);
  };
  const web = `drapixai-resource-web-${id}`;
  createProbe(web, String.raw`
    const fs=require('node:fs'),assert=require('node:assert/strict');
    assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'134217728');
    assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim(),'0');
    assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'64');
    const [quota,period]=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(' ').map(Number);
    assert.equal(quota/period,0.5);
    require('node:http').createServer((_req,res)=>res.end('healthy')).listen(8000,'0.0.0.0');
  `, true);
  docker(['start', web]);
  const address = docker(['port', web, '8000/tcp']);
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const port = Number(address.split(':').at(-1));
  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await get(port).catch(() => 0) === 200) { healthy = true; break; }
    await delay(100);
  }
  assert.ok(healthy, 'Kernel CPU/RAM/swap/process assertions and web readiness');
  pass('Linux cgroup v2 enforces the CPU, memory, swap and process budgets');
  const offender = `drapixai-resource-oom-${id}`;
  createProbe(offender, 'Buffer.alloc(256 * 1024 * 1024, 1); setInterval(()=>{}, 1000);');
  docker(['start', offender]);
  assert.equal(docker(['wait', offender]), '137');
  const killed = JSON.parse(docker(['inspect', offender]))[0];
  assert.equal(killed.State.OOMKilled, true);
  assert.equal(await get(port), 200);
  pass('An allocation above the isolated 128 MiB cap is OOM-killed while the neighboring web fixture remains healthy');
  report.passed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  report.ownedFixturesRemoved = true;
  for (const name of ownedContainers) {
    const inspected = run(['inspect', name]);
    if (inspected.status !== 0 || JSON.parse(inspected.stdout)[0].Config.Labels['drapixai.resource-fixture'] !== id
      || run(['rm', '-fv', name]).status !== 0) report.ownedFixturesRemoved = false;
  }
  if (!report.ownedFixturesRemoved) { report.passed = false; process.exitCode = 1; }
  report.recordedAt = new Date().toISOString();
  report.sourceSha256['scripts/verify-container-resources.mjs'] = crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, budgets: report.budgets,
    failure: report.failure, evidence: path.relative(root, path.join(out, 'report.json')) }));
}
