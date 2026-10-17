"""Offline upstream Node subsystem tests for an already built review candidate.

Does not build, pull or promote images. The source-build and runtime image must
contain the same binary and reviewed library bytes. Tests run in the build image;
they supplement, not replace, actual distroless runtime/application verification.
"""
import argparse
import datetime
import hashlib
import json
import re
import secrets
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = '/build/node-v22.23.3'
FAMILIES = ['crypto', 'tls', 'https', 'http2']
SAFETY = ['--pull=never', '--network', 'none', '--read-only', '--user', '65532:65532',
          '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '2g',
          '--cpus', '2', '--pids-limit', '256', '--ulimit', 'core=0', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m']


def command(args, timeout=60):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=ROOT)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout or 'Command failed')
    return result.stdout.strip()


def parse_tap(text):
    plans = re.findall(r'^1\.\.(\d+)$', text, re.M)
    cases = re.findall(r'^(ok|not ok) (\d+) (.+)$', text, re.M)
    def single(pattern):
        values = re.findall(pattern, text, re.M)
        return int(values[0]) if len(values) == 1 else None
    skipped = lambda name: bool(re.search(r'#\s*(skip|todo)\b', name, re.I))
    result = {'planned': int(plans[0]) if len(plans) == 1 else None, 'executed': len(cases),
              'failures': [name for status, _, name in cases if status == 'not ok'],
              'skipped': [name for _, _, name in cases if re.search(r'#\s*skip\b', name, re.I)],
              'todos': [name for _, _, name in cases if re.search(r'#\s*todo\b', name, re.I)],
              'familyCounts': {family: sum(bool(re.match(rf'^parallel/test-{family}(?:[-.]|$)', name)) and not skipped(name)
                                          for _, _, name in cases) for family in FAMILIES},
              'selectedTotal': single(r'^Total: (\d+) tests$'),
              'excludedByUpstreamStatus': single(r'^ \* +(\d+) tests will be skipped$'),
              'expectedPass': single(r'^ \* +(\d+) tests are expected to pass$'),
              'expectedFailures': sum(map(int, re.findall(r'^ \* +(\d+) tests are expected to fail', text, re.M)))}
    numbers = [int(number) for _, number, _ in cases]
    summary_complete = result['selectedTotal'] is not None and result['excludedByUpstreamStatus'] is not None and result['selectedTotal']-result['excludedByUpstreamStatus'] == result['planned'] == result['expectedPass']
    result['complete'] = bool(cases) and summary_complete and result['planned'] == len(cases) and numbers == list(range(1, len(cases)+1))
    result['passed'] = result['complete'] and not result['failures'] and not result['todos'] and not result['expectedFailures'] and all(result['familyCounts'].values())
    return result


def verify(args):
    identity = secrets.token_hex(12)
    output = ROOT/'runtime/security-candidate/node-shared-openssl'/f'upstream-{identity}'
    output.mkdir(parents=True, exist_ok=False)
    cid_file = output/'tests.cid'
    fixture_cids = []
    report = {'scope': 'offline upstream parallel crypto/TLS/HTTPS/HTTP2 tests in source-build image; not full Node CI or production approval',
              'passed': False, 'productionApproved': False, 'images': {},
              'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'verifierSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    try:
        report['sourceCommit'] = command(['git', 'rev-parse', 'HEAD'])
        if not re.fullmatch('[a-f0-9]{40}', report['sourceCommit']):
            raise ValueError('Unable to establish verifier source commit')
        report['dirtyCheckout'] = bool(command(['git', 'status', '--porcelain']))
        probe = r"""
const fs=require('node:fs'),c=require('node:crypto'),a=require('node:assert/strict');
const p=JSON.parse(fs.readFileSync(process.env.DRAPIXAI_PROVENANCE,'utf8'));
const sha=f=>c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
a.equal(process.getuid(),65532);a.equal(process.versions.node,'22.23.3');
a.equal(process.versions.modules,'127');a.equal(process.config.variables.node_shared_openssl,true);
a.equal(p.channel,'shared-openssl-review-candidate');a.equal(p.productionApproved,false);
a.equal(sha(process.execPath),p.nodeSha256);
for(const [file,digest]of Object.entries(p.librarySha256))a.equal(sha(file),digest);
for(const lib of ['libssl.so.3','libcrypto.so.3'])a.ok(process.report.getReport().sharedObjects.some(p=>p.endsWith(lib)));
console.log(JSON.stringify({nodeSha256:p.nodeSha256,librarySha256:p.librarySha256,source:p.source,
package:p.debianOpenSSLVersion,node:process.versions.node,openssl:process.versions.openssl}));
"""
        for role, ref, binary, provenance in [
                ('runtime', args.runtime_image, '/nodejs/bin/node', '/usr/share/drapixai/node-build-provenance.json'),
                ('build', args.build_image, '/opt/drapixai-node/bin/node', '/opt/drapixai-node/build-provenance.json')]:
            if not re.fullmatch('[a-zA-Z0-9][a-zA-Z0-9./:@_-]+', ref):
                raise ValueError('Provide local image references')
            image = json.loads(command(['docker', 'image', 'inspect', ref]))[0]
            if not re.fullmatch('sha256:[a-f0-9]{64}', image['Id']):
                raise ValueError('Missing immutable local image identity')
            if role == 'runtime' and (image.get('Config', {}).get('Labels') or {}).get('io.drapixai.node-channel') != 'shared-openssl-review-candidate':
                raise ValueError('Runtime is not in the shared-OpenSSL review channel')
            probe_cid = output/f'{role}.cid'
            fixture_cids.append(probe_cid)
            actual = json.loads(command(['docker', 'run', '--rm', '--cidfile', str(probe_cid),
                '--name', f'drapixai-upstream-{role}-{identity}', '--label', f'drapixai.fixture={identity}', *SAFETY,
                '--env', f'DRAPIXAI_PROVENANCE={provenance}', '--entrypoint', binary, image['Id'], '-e', probe]))
            report['images'][role] = {'ref': ref, 'imageId': image['Id'], 'actual': actual}
        if report['images']['build']['actual'] != report['images']['runtime']['actual']:
            raise ValueError('Source-build and runtime binary/library provenance differs')
        expected_source = 'bd97093e1a1e9243338950c174a693a64d4e0926a9c6ce259962bc58d5e96909'
        if report['images']['build']['actual']['source']['sha256'] != expected_source:
            raise ValueError('Unreviewed Node source archive')
        environment_cid = output/'environment.cid'
        fixture_cids.append(environment_cid)
        environment = """import hashlib,json,platform,subprocess
from pathlib import Path
files=['/usr/bin/openssl','tools/test.py','test/common/crypto.js']
print(json.dumps({'python':platform.python_version(),
'opensslCliVersion':subprocess.check_output(['/usr/bin/openssl','version'],text=True,timeout=5).strip(),
'sha256':{file:hashlib.sha256(Path(file).read_bytes()).hexdigest() for file in files}}))
"""
        report['testEnvironment'] = json.loads(command(['docker', 'run', '--rm', '--cidfile', str(environment_cid),
            '--name', f'drapixai-upstream-environment-{identity}', '--label', f'drapixai.fixture={identity}',
            *SAFETY, '--workdir', SOURCE, '--entrypoint', 'python3', report['images']['build']['imageId'], '-c', environment]))
        selections = [f'parallel/test-{family}*' for family in FAMILIES]
        test_args = ['tools/test.py', '--shell', '/opt/drapixai-node/bin/node', '--progress', 'tap',
                     '--report', '-j', '2', '--timeout', '90', '--temp-dir', '/tmp/node-tests',
                     '--flaky-tests', 'run', *selections]
        report['upstreamArguments'] = test_args
        print(json.dumps({'state': 'running upstream tests', 'output': str(output), 'selections': selections}), flush=True)
        fixture_cids.append(cid_file)
        with (output/'stdout.txt').open('wb') as stdout, (output/'stderr.txt').open('wb') as stderr:
            result = subprocess.run(['docker', 'run', '--rm', '--cidfile', str(cid_file),
                '--name', f'drapixai-upstream-{identity}', '--label', f'drapixai.fixture={identity}',
                *SAFETY, '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'HOME=/tmp',
                '--env', 'PATH=/opt/drapixai-node/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                '--workdir', SOURCE, '--entrypoint', 'python3', report['images']['build']['imageId'],
                *test_args], stdout=stdout, stderr=stderr, timeout=2100, cwd=ROOT)
        report['runnerExitCode'] = result.returncode
        text = (output/'stdout.txt').read_text(encoding='utf-8', errors='replace')
        report['tap'] = parse_tap(text)
        if result.returncode or not report['tap']['passed']:
            raise ValueError('Upstream runner failed, reported TODO/failure, omitted subsystem or produced incomplete TAP; inspect raw logs')
        report['passed'] = True
    except Exception as error:
        report['failure'] = str(error)
    finally:
        for fixture_cid in fixture_cids:
            if not fixture_cid.exists():
                continue
            try:
                cid = fixture_cid.read_text().strip()
                if not re.fullmatch('[a-f0-9]{64}', cid):
                    raise ValueError('Invalid fixture container identity')
                result = subprocess.run(['docker', 'inspect', cid], capture_output=True, text=True, timeout=15)
                if result.returncode == 0:
                    info = json.loads(result.stdout)[0]
                    if info['Config']['Labels'].get('drapixai.fixture') != identity:
                        raise ValueError('Refusing to clean up unrelated container')
                    command(['docker', 'rm', '-f', cid])
                elif not re.search(r'No such (object|container)', result.stderr, re.I):
                    raise ValueError('Unable to establish fixture cleanup state')
            except Exception as error:
                report['cleanupFailure'] = str(error)
                report['passed'] = False
        report['logSha256'] = {file: hashlib.sha256((output/file).read_bytes()).hexdigest()
                               for file in ['stdout.txt', 'stderr.txt'] if (output/file).exists()}
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
        print(json.dumps({'passed': report['passed'], 'report': str(output/'report.json'),
                          'failure': report.get('failure'), 'cleanupFailure': report.get('cleanupFailure')}))
    return report['passed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-image', required=True)
    parser.add_argument('--runtime-image', required=True)
    raise SystemExit(0 if verify(parser.parse_args()) else 1)
