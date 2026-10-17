"""Verify public Node release metadata offline using an explicitly reviewed key.

No download, package installation or personal keyring change. The caller supplies
the official key snapshot; its HTTPS bootstrap is not an out-of-band attestation.
This does not turn the Dockerfile's checksum check into an in-build GPG step.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
VERSION = '22.23.3'
ARCHIVE = f'node-v{VERSION}.tar.xz'
PIN = 'bd97093e1a1e9243338950c174a693a64d4e0926a9c6ce259962bc58d5e96909'
PRIMARY = '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356'
KEYRING_REVISION = '481637f813e912c4aa3622d7964ab426c97b8e8d'
KEYRING_SHA256 = '610b8d249da3d5733f5a128def2dd0294dbbf5b5713e6ca2529db8db419dee00'


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


def verify(args):
    output = args.output_dir.resolve()
    parent = (ROOT/'runtime/security-candidate').resolve()
    if not output.is_relative_to(parent) or output == parent:
        raise ValueError('Output must be below runtime/security-candidate')
    if args.keyring_revision != KEYRING_REVISION:
        raise ValueError('Unreviewed official release-key snapshot revision')
    manifest = args.manifest.read_bytes()
    keyring = args.keyring.read_bytes()
    if not 0 < len(manifest) <= 128*1024 or not 0 < len(keyring) <= 2*1024*1024:
        raise ValueError('Unexpected public metadata size')
    if hashlib.sha256(keyring).hexdigest() != KEYRING_SHA256:
        raise ValueError('Release-key file differs from the reviewed snapshot')
    recipe = HERE/'Dockerfile.shared-openssl'
    if f'{PIN}  node.tar.xz' not in recipe.read_text() or f'/v{VERSION}/node-v{VERSION}.tar.xz' not in recipe.read_text():
        raise ValueError('Source recipe changed: review the version, pin and signer first')
    output.mkdir(parents=True, exist_ok=False)
    home = output/'gnupg'
    home.mkdir()
    signed = output/'SHASUMS256.txt.asc'
    keys = output/'pubring.kbx'
    signed.write_bytes(manifest)
    keys.write_bytes(keyring)
    report = {'scope': 'offline source-signature evidence, not runtime or production approval',
              'passed': False, 'productionApproved': False, 'sourceVersion': VERSION,
              'archive': ARCHIVE, 'archiveSha256': PIN, 'reviewedPrimaryFingerprint': PRIMARY,
              'keyringRevision': args.keyring_revision,
              'trustBootstrap': 'Caller-supplied official nodejs/release-keys HTTPS snapshot; fingerprint reviewed against versioned Node README; no out-of-band identity attestation',
              'recipeSha256': digest(recipe), 'verifierSha256': digest(Path(__file__)),
              'inputs': {'signedManifestSha256': digest(signed), 'keyringSha256': digest(keys)}}

    def run(source, ring, verified=None):
        command = [args.gpgv, '--homedir', home.as_posix(), '--keyring', ring.as_posix(), '--status-fd', '1']
        if verified:
            command += ['--output', verified.as_posix()]
        result = subprocess.run(command+[source.as_posix()], capture_output=True, text=True, timeout=30)
        return {'exitCode': result.returncode, 'status': result.stdout, 'diagnostics': result.stderr}

    try:
        verified = output/'verified-SHASUMS256.txt'
        positive = run(signed, keys, verified)
        report['signature'] = positive
        valid = [line.split() for line in positive['status'].splitlines() if line.startswith('[GNUPG:] VALIDSIG ')]
        if positive['exitCode'] != 0 or len(valid) != 1 or len(valid[0]) != 12:
            raise ValueError('Expected exactly one valid release signature')
        if any('[GNUPG:] '+marker+' ' in positive['status'] for marker in
               ['BADSIG', 'ERRSIG', 'EXPKEYSIG', 'EXPSIG', 'REVKEYSIG', 'KEYEXPIRED', 'SIGEXPIRED']):
            raise ValueError('Release signature has an adverse verification status')
        # VALIDSIG: signing fingerprint, date, timestamp, expiry, version,
        # reserved, public-key algorithm, hash algorithm, class, primary key.
        if valid[0][-1] != PRIMARY or valid[0][9] not in {'8', '9', '10'} or valid[0][10] != '01':
            raise ValueError('Unreviewed signer, weak digest or unexpected signature class')
        matches = [line for line in verified.read_text().splitlines() if line.endswith('  '+ARCHIVE)]
        if matches != [PIN+'  '+ARCHIVE]:
            raise ValueError('Signed source checksum differs from the reviewed build pin')
        report['verifiedManifestSha256'] = digest(verified)
        changed = output/'tampered-SHASUMS256.txt.asc'
        if manifest.count(PIN.encode()) != 1:
            raise ValueError('Expected one pinned source checksum in the signed manifest')
        changed.write_bytes(manifest.replace(PIN.encode(), b'0'+PIN[1:].encode(), 1))
        untrusted = output/'empty-keyring.kbx'
        untrusted.write_bytes(b'')
        report['negativeControls'] = []
        for name, source, ring, marker in [
                ('changed signed checksum', changed, keys, '[GNUPG:] BADSIG '),
                ('untrusted signing key', signed, untrusted, '[GNUPG:] NO_PUBKEY ')]:
            result = run(source, ring)
            report['negativeControls'].append({'name': name, **result})
            if result['exitCode'] == 0 or marker not in result['status']:
                raise ValueError(f'Negative control did not fail as expected: {name}')
        report['passed'] = True
    except Exception as error:
        report['failure'] = str(error)
    finally:
        (output/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'passed': report['passed'], 'report': str(output/'report.json'),
                      'failure': report.get('failure')}))
    return report['passed']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gpgv', required=True, help='Existing trusted verification-only executable')
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--keyring', required=True, type=Path)
    parser.add_argument('--keyring-revision', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    raise SystemExit(0 if verify(parser.parse_args()) else 1)
