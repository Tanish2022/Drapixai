import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const [apiRef] = process.argv.slice(2);
assert.ok(apiRef, 'Usage: node scripts/verify-staging-secret-installation.mjs <api-image>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = crypto.randomBytes(8).toString('hex'), volume = `drapixai-secret-install-${id}`;
const label = `drapixai.secret-install-fixture=${id}`;
const pythonImage = 'python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258';
const output = path.join(root, 'runtime/launch-evidence', `edge-secret-install-${id}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
const installer = 'deploy/staging/prepare-secret-permissions.py', generator = 'deploy/scripts/generate-staging-secrets.py';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = { passed: false, scope: 'Actual Linux metadata installer and production API secret loader with synthetic credentials in an owned volume; independent generated-seed TOTP comparison; not live credentials, certificates, provider delivery or full server startup', checks: [], source: {} };
for (const name of [installer, generator, 'scripts/verify-staging-secret-installation.mjs']) report.source[name] = hash(fs.readFileSync(path.join(root, name)));
const invoke = (args, timeout = 30000) => spawnSync('docker', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 2 * 1024 * 1024 });
const docker = (args, timeout) => { const r = invoke(args, timeout); assert.equal(r.status, 0, r.error?.message || r.stderr || r.stdout || 'Docker fixture failed'); return r.stdout.trim(); };
const bounds = ['--network', 'none', '--read-only', '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1', '--pids-limit', '64', '--ulimit', 'core=0'];
const rootCaps = ['--user', '0:0', '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--cap-add', 'FOWNER', '--cap-add', 'DAC_OVERRIDE'];
let created = false, mountpoint;
const python = (code, args = [], asUser = '0:0') => invoke(['run', '--pull=never', '--rm', '--label', label, ...bounds,
  ...(asUser === '0:0' ? rootCaps : ['--user', asUser, '--cap-drop', 'ALL']),
  '--mount', `type=volume,src=${volume},dst=/fixture/private`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m',
  '--mount', `type=bind,src=${path.join(root, installer)},dst=/opt/prepare.py,readonly`,
  '--mount', `type=bind,src=${path.join(root, generator)},dst=/opt/deploy/scripts/generate-staging-secrets.py,readonly`,
  '--entrypoint', 'python', pythonImage, '-c', code, ...args]);
const checkPython = (code, args, user) => { const r = python(code, args, user); assert.equal(r.status, 0, r.error?.message || r.stderr || r.stdout); return r.stdout.trim(); };
const setup = String.raw`
import base64, contextlib, hashlib, hmac, importlib.util, io, json, os, struct, sys
from pathlib import Path
directory=Path('/fixture/private')
for p in directory.iterdir(): p.unlink()
os.chown(directory,0,0);os.chmod(directory,0o700)
os.environ['DRAPIXAI_STRIPE_SECRET_KEY']='sk_test_'+'synthetic'*8
os.environ['DRAPIXAI_STRIPE_WEBHOOK_SECRET']='whsec_'+'synthetic'*8
spec=importlib.util.spec_from_file_location('fixture_generator','/opt/deploy/scripts/generate-staging-secrets.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
sys.argv=['generate.py','--output-dir',str(directory)]
with contextlib.redirect_stdout(io.StringIO()): assert g.main()==0
for name in ['drapixai-internal-ca.pem','drapixai-ai-client.crt','drapixai-ai-client.key']:
    p=directory/name;p.write_text('synthetic-certificate-fixture-only');p.chmod(0o600)
api=json.loads((directory/'drapixai-api.json').read_text())
seed=base64.b32decode(api['DRAPIXAI_ADMIN_TOTP_SECRET'],casefold=False);assert len(seed)==20
def totp(counter):
 digest=hmac.new(seed,struct.pack('>Q',counter),hashlib.sha1).digest();offset=digest[-1]&15
 return str((struct.unpack('>I',digest[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
code=totp(1);window={totp(counter) for counter in [0,1,2]};bad=next(str(n).zfill(6) for n in range(4) if str(n).zfill(6) not in window)
hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in directory.iterdir()}
for p in directory.iterdir(): os.chown(p,1000,1000)
os.chown(directory,1000,1000)
expected=directory/'fixture-expectations.json';expected.write_text(json.dumps({'hashes':hashes,'mfaCode':code,'badMfaCode':bad}));expected.chmod(0o400);os.chown(expected,65532,65532)
`; // Corruptions are appended below; no real operator path is ever read.
const apply = String.raw`import sys;sys.path.insert(0,'/opt');import prepare;print(__import__('json').dumps(prepare.prepare(__import__('pathlib').Path(sys.argv[1]),'--check' in sys.argv)))`;
const unchanged = String.raw`
import hashlib,json,os,stat
from pathlib import Path
d=Path('/fixture/private');e=json.loads((d/'fixture-expectations.json').read_text())
for name in ['drapixai-api.json','drapixai-internal-ca.pem','drapixai-ai-client.crt','postgres_password','api_database_password']:
 p=d/name;s=p.stat();assert s.st_uid==1000 and stat.S_IMODE(s.st_mode)==0o600;assert hashlib.sha256(p.read_bytes()).hexdigest()==e['hashes'][name]
assert d.stat().st_uid==1000
`;
const apiProbe = String.raw`
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{const {loadExternalSecrets}=require('./dist/lib/external-secrets.js');
if(process.argv[1]==='denied'){await assert.rejects(loadExternalSecrets(),e=>e.code==='EACCES');console.log(JSON.stringify({passed:true,uid:process.getuid(),expected:'EACCES'}));return;}
assert.equal(process.getuid(),65532);const expected=JSON.parse(fs.readFileSync('/run/secrets/fixture-expectations.json','utf8'));
for(const name of ['drapixai-api.json','drapixai-internal-ca.pem','drapixai-ai-client.crt','drapixai-ai-client.key']){const file='/run/secrets/'+(name==='drapixai-api.json'?'drapixai-api':name);const s=fs.statSync(file);assert.equal(s.uid,65532);assert.equal(s.gid,65532);assert.equal(s.mode&0o777,0o400);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),expected.hashes[name]);}
const loaded=await loadExternalSecrets();assert.ok(loaded>=16);
const {verifyAdminTotp}=require('./dist/lib/admin-mfa.js');assert.equal(verifyAdminTotp('fixture@example.invalid',expected.mfaCode,59000,true),true);
assert.equal(verifyAdminTotp('fixture@example.invalid',expected.badMfaCode,59000,true),false);
console.log(JSON.stringify({passed:true,uid:process.getuid(),loaded,privateFiles:4,independentTotp:true}));})().catch(()=>{console.error('Synthetic secret-loader or TOTP assertion failed');process.exitCode=1;});
`;
const api = (expectation, user = null) => {
  const names = ['drapixai-api.json', 'drapixai-internal-ca.pem', 'drapixai-ai-client.crt', 'drapixai-ai-client.key', 'fixture-expectations.json'];
  const mounts = names.flatMap(name => ['--mount', `type=bind,src=${mountpoint}/${name},dst=/run/secrets/${name === 'drapixai-api.json' ? 'drapixai-api' : name},readonly`]);
  const result = docker(['run', '--pull=never', '--rm', '--label', label, ...bounds, '--cap-drop', 'ALL', ...(user ? ['--user', user] : []), ...mounts,
    '-e', 'NODE_ENV=production', '-e', 'DRAPIXAI_SECRETS_PROVIDER=mounted-file', '-e', 'DRAPIXAI_MOUNTED_SECRET_FILE=/run/secrets/drapixai-api',
    report.apiImageId, '-e', apiProbe, expectation]);
  return JSON.parse(result);
};
try {
  report.apiImageId = JSON.parse(docker(['image', 'inspect', apiRef]))[0].Id;
  assert.match(report.apiImageId, /^sha256:[a-f0-9]{64}$/);
  if (invoke(['image', 'inspect', pythonImage]).status !== 0) docker(['pull', pythonImage], 180000);
  report.pythonImageId = JSON.parse(docker(['image', 'inspect', pythonImage]))[0].Id;
  assert.equal(docker(['volume', 'create', '--label', label, volume]), volume); created = true;
  const metadata = JSON.parse(docker(['volume', 'inspect', volume]))[0];
  assert.equal(metadata.Labels['drapixai.secret-install-fixture'], id);
  mountpoint = metadata.Mountpoint; assert.ok(mountpoint.startsWith('/') && mountpoint.endsWith(`/${volume}/_data`) && !mountpoint.includes('..'));
  checkPython(setup);
  api('denied'); report.checks.push('Actual service UID cannot load operator-owned private JSON');
  assert.notEqual(python(apply, ['/fixture/private', '--check']).status, 0);
  checkPython(unchanged); report.checks.push('Check-only rejects unprepared metadata without changing files');
  checkPython(apply, ['/fixture/private']); checkPython(apply, ['/fixture/private', '--check']);
  const positive = api('readable'); report.loader = positive;
  report.checks.push('Installed private files remain byte-identical and readable only by actual service; Python TOTP matches real production verifier');
  checkPython(apply, ['/fixture/private']); api('readable');
  checkPython(String.raw`
import hashlib,json,stat
from pathlib import Path
d=Path('/fixture/private');e=json.loads((d/'fixture-expectations.json').read_text())
for name in ['postgres_password','api_database_password','redis_password']:
 p=d/name;metadata=p.stat()
 assert metadata.st_uid==1000 and metadata.st_gid==1000 and stat.S_IMODE(metadata.st_mode)==0o600
 assert hashlib.sha256(p.read_bytes()).hexdigest()==e['hashes'][name]
`);
  report.checks.push('Idempotent installation preserves separate database/bootstrap/Redis credential bytes and metadata');
  api('denied', '1000:1000'); report.checks.push('Other non-root UID cannot read the installed API bundle');
  checkPython(setup);
  checkPython(String.raw`
import errno,hashlib,json,os,sys
from pathlib import Path
sys.path.insert(0,'/opt');import prepare
original=os.fchown;calls=0
def fail_second(*args):
 global calls
 calls+=1
 if calls==2: raise OSError(errno.EIO,'synthetic metadata failure')
 return original(*args)
prepare.os.fchown=fail_second
try: prepare.prepare(Path('/fixture/private'));raise AssertionError('Failure was not exercised')
except OSError as error: assert error.errno==errno.EIO
finally: prepare.os.fchown=original
d=Path('/fixture/private');assert d.stat().st_uid==1000
e=json.loads((d/'fixture-expectations.json').read_text())
for name,digest in e['hashes'].items(): assert hashlib.sha256((d/name).read_bytes()).hexdigest()==digest
`);
  checkPython(apply, ['/fixture/private']); checkPython(apply, ['/fixture/private', '--check']); api('readable');
  report.checks.push('Interrupted metadata installation preserves bytes and an ordinary retry completes');
  for (const [name, corruption] of [
    ['missing', "(directory/'drapixai-ai-client.key').unlink()"],
    ['symlink', "(directory/'drapixai-ai-client.key').unlink();os.symlink('drapixai-api.json',directory/'drapixai-ai-client.key')"],
    ['hardlink', "(directory/'drapixai-ai-client.key').unlink();os.link(directory/'drapixai-api.json',directory/'drapixai-ai-client.key')"],
    ['fifo', "(directory/'drapixai-ai-client.key').unlink();os.mkfifo(directory/'drapixai-ai-client.key',0o600)"],
    ['writable-directory', "os.chmod(directory,0o777)"],
  ]) {
    checkPython(setup + '\n' + corruption);
    const result = python(apply, ['/fixture/private']); assert.equal(result.status, 1, `Unsafe ${name} input must be rejected without timeout`);
    checkPython(unchanged); report.checks.push(`Reject ${name} before mutating target files`);
  }
  checkPython(setup);
  const directoryLink = python(String.raw`import os,sys;os.symlink('/fixture/private','/tmp/private-link');sys.path.insert(0,'/opt');import prepare;prepare.prepare(__import__('pathlib').Path('/tmp/private-link'))`);
  assert.equal(directoryLink.status, 1); checkPython(unchanged); report.checks.push('Reject a symlinked private directory');
  assert.equal(python(apply, ['/fixture/private'], '1000:1000').status, 1); checkPython(unchanged); report.checks.push('Reject unprivileged installation before metadata changes');
  assert.equal(report.checks.length, 13); report.passed = true;
} catch (error) { report.failure = String(error.message); process.exitCode = 1; }
finally {
  const owned = invoke(['ps', '-aq', '--filter', `label=${label}`]);
  if (owned.status !== 0) { report.passed = false; report.cleanupFailure = true; process.exitCode = 1; }
  else for (const cid of owned.stdout.trim().split(/\s+/).filter(Boolean)) if (!/^[a-f0-9]{12,64}$/.test(cid) || invoke(['rm', '-fv', cid]).status !== 0) { report.passed = false; report.cleanupFailure = true; process.exitCode = 1; }
  if (created) {
    const check = invoke(['volume', 'inspect', volume]);
    if (check.status !== 0 || JSON.parse(check.stdout)[0].Labels?.['drapixai.secret-install-fixture'] !== id || invoke(['volume', 'rm', volume]).status !== 0) { report.passed = false; report.cleanupFailure = true; process.exitCode = 1; }
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, evidence: path.relative(root, output), failure: report.failure || (report.cleanupFailure ? 'Owned fixture cleanup failed' : null) }));
}
