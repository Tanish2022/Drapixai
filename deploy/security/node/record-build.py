"""Record the actual downstream build; no upstream/production approval implied."""
import hashlib
import json
import subprocess
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


node = '/opt/drapixai-node/bin/node'
runtime = json.loads(subprocess.check_output([node, '-e', "console.log(JSON.stringify({node:process.versions.node,openssl:process.versions.openssl,modules:process.versions.modules,icu:process.versions.icu,sharedOpenSSL:process.config.variables.node_shared_openssl,sharedObjects:process.report.getReport().sharedObjects}))"], text=True))
assert runtime['node'] == '22.23.3' and runtime['modules'] == '127'
assert runtime['sharedOpenSSL'] is True
needed = subprocess.check_output(['readelf', '-d', node], text=True)
assert 'libssl.so.3' in needed and 'libcrypto.so.3' in needed
symbols = subprocess.check_output(['nm', '-D', '--defined-only', node], text=True)
assert not any(line.split()[-1].split('@')[0] in {'SSL_new', 'SSL_connect', 'OpenSSL_version', 'DTLS_method'} for line in symbols.splitlines() if line.split())
version = subprocess.check_output(['dpkg-query', '-W', '-f=${Version}', 'libssl3t64'], text=True)
subprocess.run(['dpkg', '--compare-versions', version, 'ge', '3.5.7-1~deb13u3'], check=True)
paths = ['/usr/lib/x86_64-linux-gnu/libssl.so.3', '/usr/lib/x86_64-linux-gnu/libcrypto.so.3']
record = {
    'channel': 'shared-openssl-review-candidate',
    'productionApproved': False,
    'source': {'url': 'https://nodejs.org/download/release/v22.23.3/node-v22.23.3.tar.xz',
               'sha256': 'bd97093e1a1e9243338950c174a693a64d4e0926a9c6ce259962bc58d5e96909',
               'authentication': 'HTTPS and reviewed pinned SHA-256; separate GPG evidence is not an in-build signature check'},
    'configure': ['--prefix=/opt/drapixai-node', '--shared-openssl', '--with-intl=full-icu'],
    'runtime': runtime,
    'nodeSha256': digest(node),
    'debianOpenSSLVersion': version,
    'librarySha256': {path: digest(path) for path in paths},
    'elfDependencies': needed,
    'nodeSourceModified': False,
}
Path('/opt/drapixai-node/build-provenance.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps({'node': runtime['node'], 'sharedOpenSSL': True, 'package': version, 'nodeSha256': record['nodeSha256']}))
