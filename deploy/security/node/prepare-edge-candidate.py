"""Create isolated API/web build inputs from a committed release, never a live checkout."""
import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
REVIEWED_DOCKERFILES = (
    '3b24bd7d8cb340a2fffc7f32470daab29e2c28464b9a84e699733e6223920e68',
    'f83c9e9847cff65b6fbbc1e640fdf22131ac22f08b55604b97b4392f7546c7d5',
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def render(original, node_dockerfile, role):
    if role not in {'api', 'web'}:
        raise ValueError('Unsupported candidate role')
    original = original.replace('\r\n', '\n')
    if sha(original.encode()) != REVIEWED_DOCKERFILES[0 if role == 'api' else 1]:
        raise ValueError('Unreviewed production Dockerfile bytes; refusing an automatic rewrite')
    builder = re.findall(r'^FROM node:22-trixie-slim@sha256:[a-f0-9]{64} AS build$', original, re.M)
    runtime = re.findall(r'^FROM gcr\.io/distroless/nodejs22-debian13:nonroot@sha256:[a-f0-9]{64} AS runtime$', original, re.M)
    if len(builder) != 1 or len(runtime) != 1 or original.count('--from=patched-openssl') != 6:
        raise ValueError('Unreviewed production Dockerfile shape; refusing an automatic rewrite')
    prefix = node_dockerfile.replace('\r\n', '\n')
    if prefix.count(' AS build\n') != 1 or prefix.count(' AS runtime\n') != 1 or prefix.count('COPY record-build.py ') != 1:
        raise ValueError('Unreviewed Node candidate Dockerfile shape')
    prefix = prefix.replace(' AS build\n', ' AS node-source-build\n').replace(' AS runtime\n', ' AS node-reviewed-runtime\n')
    prefix = prefix.replace('--from=build ', '--from=node-source-build ').replace('COPY record-build.py ', 'COPY deploy/security/node/record-build.py ')
    build_overlay = '\n'.join([
        'COPY --from=node-source-build /opt/drapixai-node/bin/node /usr/local/bin/node',
        'COPY --from=node-source-build /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3',
        'COPY --from=node-source-build /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3',
        'COPY --from=node-source-build /usr/lib/x86_64-linux-gnu/engines-3 /usr/lib/x86_64-linux-gnu/engines-3',
        'COPY --from=node-source-build /usr/lib/x86_64-linux-gnu/ossl-modules /usr/lib/x86_64-linux-gnu/ossl-modules',
    ])
    candidate = original.replace(builder[0], builder[0]+'\n'+build_overlay, 1)
    candidate = candidate.replace('--from=patched-openssl ', '--from=node-source-build ')
    runtime_overlay = '\n'.join([
        'COPY --from=node-source-build /opt/drapixai-node/bin/node /nodejs/bin/node',
        'COPY --from=node-source-build /opt/drapixai-node/build-provenance.json /usr/share/drapixai/node-build-provenance.json',
        'COPY --from=node-source-build /build/node-v22.23.3/LICENSE /usr/share/drapixai/Node.LICENSE',
        'COPY --from=node-source-build /usr/share/doc/libssl3t64/copyright /usr/share/drapixai/OpenSSL.copyright',
        'COPY --from=node-source-build /usr/share/common-licenses/Apache-2.0 /usr/share/drapixai/Apache-2.0',
        'LABEL io.drapixai.node-channel="shared-openssl-review-candidate"',
    ])
    candidate = candidate.replace(runtime[0], runtime[0]+'\n'+runtime_overlay, 1)
    return prefix+'\n# Committed application source; candidate overlay only.\n'+candidate


def materialize(commit, output):
    if not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('An exact 40-character commit is required')
    if subprocess.check_output(['git', 'cat-file', '-t', commit], cwd=ROOT, text=True).strip() != 'commit':
        raise ValueError('Release input is not a Git commit')
    output = output.resolve()
    allowed = (ROOT/'runtime/security-candidate').resolve()
    if not output.is_relative_to(allowed) or output == allowed:
        raise ValueError('Candidate output must be a new directory below runtime/security-candidate')
    if output.exists():
        raise ValueError('Refusing to overwrite candidate output')
    output.mkdir(parents=True)
    archive = output/'source.zip'
    context = output/'context'
    context.mkdir()
    entries = []
    portable_paths = set()
    for row in subprocess.check_output(['git', 'ls-tree', '-rz', commit], cwd=ROOT).split(b'\0'):
        if not row:
            continue
        metadata, name = row.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split(' ')
        if mode not in {'100644', '100755'} or kind != 'blob':
            raise ValueError('Candidate context refuses symlinks/submodules/special entries')
        filename = name.decode('utf-8')
        target = (context/filename).resolve()
        if not target.is_relative_to(context):
            raise ValueError('Unsafe Git path')
        portable_name = filename.replace('\\', '/').casefold()
        if portable_name in portable_paths:
            raise ValueError('Candidate context refuses case-colliding paths')
        portable_paths.add(portable_name)
        entries.append((filename, target, mode, oid))
    # git archive can convert LF blobs to CRLF on Windows. Read raw objects in
    # one batch instead; check each object's identity before writing its bytes.
    batch = subprocess.check_output(['git', 'cat-file', '--batch'], cwd=ROOT,
        input=('\n'.join(entry[3] for entry in entries)+'\n').encode())
    cursor = 0
    source_hashes = {}
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for filename, target, mode, oid in entries:
            header_end = batch.index(b'\n', cursor)
            object_id, object_kind, length = batch[cursor:header_end].decode().split(' ')
            size = int(length)
            content = batch[header_end+1:header_end+1+size]
            if object_id != oid or object_kind != 'blob' or hashlib.sha1(f'blob {size}\0'.encode()+content).hexdigest() != oid:
                raise ValueError('Git object identity mismatch')
            cursor = header_end+size+2
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            source_hashes[filename] = sha(content)
            info = zipfile.ZipInfo(filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = int(mode, 8) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, content)
    if cursor != len(batch):
        raise ValueError('Unexpected trailing Git object output')
    for filename, expected in source_hashes.items():
        if sha((context/filename).read_bytes()) != expected:
            raise ValueError('Materialized source does not match its Git blob')
    inputs = {}
    for file in ['Dockerfile.shared-openssl', 'record-build.py']:
        content = (HERE/file).read_bytes()
        target = context/'deploy/security/node'/file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        inputs[file] = sha(content)
    node = (HERE/'Dockerfile.shared-openssl').read_text()
    generated = {}
    for role in ['api', 'web']:
        original = (context/f'apps/{role}/Dockerfile').read_bytes()
        content = render(original.decode(), node, role).encode()
        file = output/f'Dockerfile.{role}.candidate'
        file.write_bytes(content)
        generated[role] = {'dockerfile': str(file), 'sha256': sha(content), 'originalSha256': sha(original)}
    checks = output/'Dockerfile.application-checks.candidate'
    checks.write_text(render((context/'apps/api/Dockerfile').read_text(), node, 'api')+'''
FROM node-source-build AS application-checks
ENV PATH=/opt/drapixai-node/bin:${PATH} NODE_ENV=test NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY . .
# This index supplies the launch suite's file inventory only. It is not release
# history or provenance; build-inputs.json binds the original raw Git objects.
RUN apt-get update && apt-get install -y --no-install-recommends git \\
    && rm -rf /var/lib/apt/lists/* \\
    && git init --quiet && git add --all
RUN node -e "require('node:assert/strict').equal(process.config.variables.node_shared_openssl,true)" \\
    && npm --prefix apps/api ci --include=dev \\
    && npm --prefix apps/web ci --include=dev
RUN cd apps/api && npx prisma generate && npx tsc --noEmit && npm run test:launch \\
    && npm run test:admin-mfa && npm run test:authorization && npm run test:storefront-tokens \\
    && npm run test:public-api && npm run test:image-upload-security && npm run test:log-privacy
RUN NODE_ENV=production npm --prefix apps/web run build \\
    && node scripts/verify-production-csp-runtime.mjs
''')
    record = {'scope': 'isolated candidate inputs, not production approval', 'productionApproved': False,
              'releaseCommit': commit, 'applicationSource': 'raw Git objects, excluding working-tree/untracked changes and EOL conversion',
              'archiveSha256': sha(archive.read_bytes()), 'context': str(context), 'candidateInputSha256': inputs,
              'contextOverlayPaths': [f'deploy/security/node/{file}' for file in inputs],
              'committedSourceSha256': source_hashes,
              'candidateToolSha256': sha(Path(__file__).read_bytes()), 'generated': generated,
              'applicationChecksDockerfile': {'path': str(checks), 'sha256': sha(checks.read_bytes())}}
    (output/'build-inputs.json').write_text(json.dumps(record, indent=2)+'\n')
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-commit', required=True)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(materialize(args.release_commit, args.output_dir), indent=2))
