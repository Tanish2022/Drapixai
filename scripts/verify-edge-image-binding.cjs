// Optional real-Docker regression. Only disposable aliases are retagged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const invoke = cp.spawnSync;

if (require.main !== module) {
  // Loaded only by this runner's child process. Never log full Docker arguments:
  // the actual verifier passes synthetic credentials to its own fixtures.
  const config = JSON.parse(fs.readFileSync(process.env.DRAPIXAI_EDGE_BINDING_CONFIG, 'utf8'));
  const events = [];
  cp.spawnSync = (command, args, options) => {
    const result = invoke(command, args, options);
    if (command === 'docker' && args[0] === 'image' && args[1] === 'inspect' && config.aliases[args[2]] && result.status === 0) {
      const ref = args[2], inspected = JSON.parse(result.stdout)[0].Id;
      const replacement = config.aliases[ref];
      assert.notEqual(inspected, replacement, 'Fixture must move the alias');
      const changed = invoke('docker', ['tag', replacement, ref], { encoding: 'utf8', timeout: 10000 });
      assert.equal(changed.status, 0, 'Failed to move owned alias');
      events.push({ action: 'tag-moved-after-inspect', ref, inspected, replacement });
    }
    if (command === 'docker' && args[0] === 'run') {
      const image = args.find(value => /^sha256:[a-f0-9]{64}$/.test(value)) || args.find(value => config.aliases[value]);
      if (image) events.push({ action: 'run-image', image });
    }
    fs.writeFileSync(config.events, JSON.stringify(events, null, 2));
    return result;
  };
  require('node:module').syncBuiltinESMExports();
} else {
  const [api, web] = process.argv.slice(2);
  assert.ok(api && web, 'Usage: node scripts/verify-edge-image-binding.cjs <local-api-image> <local-web-image>');
  const id = crypto.randomBytes(10).toString('hex');
  const output = path.join(root, 'runtime/launch-evidence', `edge-image-binding-${id}`);
  fs.mkdirSync(output, { recursive: true });
  const docker = (args) => {
    const result = invoke('docker', args, { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.error?.message || result.stderr || 'Docker fixture operation failed');
    return result.stdout;
  };
  const owned = [];
  const report = { scope: 'owned local image-alias movement regression; not live staging or candidate crypto approval', passed: false, images: {} };
  try {
    for (const [role, ref] of [['api', api], ['web', web]]) {
      const info = JSON.parse(docker(['image', 'inspect', ref]))[0];
      assert.match(info.Id, /^sha256:[a-f0-9]{64}$/);
      assert.ok(info.RepoTags?.some(tag => !tag.startsWith(`drapixai-binding-${id}-`)), 'Fixture requires an existing tag to preserve the source image');
      report.images[role] = { ref, imageId: info.Id, alias: `drapixai-binding-${id}-${role}:fixture` };
    }
    assert.notEqual(report.images.api.imageId, report.images.web.imageId);
    for (const item of Object.values(report.images)) { docker(['tag', item.imageId, item.alias]); owned.push(item.alias); }
    const events = path.join(output, 'events.json');
    const config = path.join(output, 'config.json');
    fs.writeFileSync(config, JSON.stringify({ events, aliases: {
      [report.images.api.alias]: report.images.web.imageId,
      [report.images.web.alias]: report.images.api.imageId,
    } }));
    const verifier = path.join(root, 'scripts/verify-edge-container-runtime.mjs');
    report.verifierSha256 = crypto.createHash('sha256').update(fs.readFileSync(verifier)).digest('hex');
    report.fixtureSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    const result = invoke(process.execPath, ['--require', __filename, verifier, report.images.api.alias, report.images.web.alias], {
      cwd: output, env: { ...process.env, DRAPIXAI_EDGE_BINDING_CONFIG: config }, encoding: 'utf8', timeout: 300000, maxBuffer: 2*1024*1024,
    });
    fs.writeFileSync(path.join(output, 'stdout.txt'), result.stdout || '');
    fs.writeFileSync(path.join(output, 'stderr.txt'), result.stderr || '');
    assert.equal(result.status, 0, result.error?.message || result.stderr || 'Native verifier failed');
    report.events = JSON.parse(fs.readFileSync(events, 'utf8'));
    assert.equal(report.events.filter(event => event.action === 'tag-moved-after-inspect').length, 2);
    const runs = report.events.filter(event => event.action === 'run-image');
    assert.equal(runs.length, 6, 'Both version probes, compiled database fixtures and all native/application runs must execute');
    for (const event of runs) assert.ok(Object.values(report.images).some(item => item.imageId === event.image));
    const evidence = /^Evidence: (.+)$/m.exec(result.stdout)?.[1].trim();
    assert.ok(evidence);
    const nativeReport = path.resolve(output, evidence);
    assert.ok(nativeReport.startsWith(path.join(root, 'runtime/launch-evidence')+path.sep));
    const native = JSON.parse(fs.readFileSync(nativeReport, 'utf8'));
    assert.equal(native.passed, true); assert.equal(native.checks.length, 5);
    assert.equal(native.authHttpFixture.imageId,report.images.api.imageId);
    assert.equal(native.authHttpFixture.checks.length,6);
    assert.equal(crypto.createHash('sha256').update(native.authHttpFixture.reportJson).digest('hex'),native.authHttpFixture.sha256);
    const nested=JSON.parse(native.authHttpFixture.reportJson);
    assert.equal(nested.passed,true);
    assert.equal(nested.images.api.id,report.images.api.imageId);
    for (const role of ['api', 'web']) assert.equal(native.images[role].imageId, report.images[role].imageId);
    report.nativeReport = nativeReport;
    report.nativeReportSha256 = crypto.createHash('sha256').update(fs.readFileSync(nativeReport)).digest('hex');
    report.passed = true;
  } catch (error) { report.failure = error.message; process.exitCode = 1; }
  finally {
    for (const alias of owned) {
      try {
        assert.ok(alias.startsWith(`drapixai-binding-${id}-`));
        const info = JSON.parse(docker(['image', 'inspect', alias]))[0];
        assert.ok(Object.values(report.images).some(item => item.imageId === info.Id), 'Refusing to untag unknown image');
        assert.ok(info.RepoTags?.some(tag => !owned.includes(tag)), 'Refusing to remove the last image tag');
        docker(['image', 'rm', alias]);
      } catch (error) { report.passed = false; report.cleanupFailure = error.message; process.exitCode = 1; }
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)+'\n');
    console.log(JSON.stringify({ passed: report.passed, report: path.join(output, 'report.json'), failure: report.failure, cleanupFailure: report.cleanupFailure }));
  }
}
