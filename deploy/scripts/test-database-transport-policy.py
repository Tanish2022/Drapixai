"""Exercise the actual database-policy block embedded in validate-env.sh.

Synthetic connection strings only; no network or real environment-file access.
"""
import os
from pathlib import Path
import subprocess
import sys

source = (Path(__file__).parent / 'validate-env.sh').read_text(encoding='utf-8')
marker = '# Read the existing exported value in-process: never put the URL in argv.'
block = source.split(marker, 1)[1].split("python3 - <<'PY'", 1)[1].split('\nPY', 1)[0]
base = 'postgresql://probe:synthetic-password@db.example.invalid/staging'
valid = [base + '?sslmode=require&sslaccept=strict',
         base.replace('postgresql:', 'postgres:') + '?sslaccept=strict&sslmode=require']
invalid = [base, base + '?sslmode=verify-full', base + '?sslmode=require',
           base + '?sslmode=prefer&sslaccept=strict',
           base + '?sslmode=disable&sslaccept=strict',
           base + '?sslmode=require&sslaccept=accept_invalid_certs',
           base + '?sslmode=require&sslaccept=strict&sslmode=disable',
           base + '?sslmode=require&sslaccept=strict&sslaccept=accept_invalid_certs',
           base + '?sslmode=require&sslaccept=strict&host=/tmp',
           base.replace('postgresql:', 'https:') + '?sslmode=require&sslaccept=strict',
           base.replace(':synthetic-password', '') + '?sslmode=require&sslaccept=strict',
           'not-a-url']
for value, expected in [(value, 0) for value in valid] + [(value, 1) for value in invalid]:
    env = {**os.environ, 'DATABASE_URL': value}
    result = subprocess.run([sys.executable, '-c', block], env=env, capture_output=True, text=True, timeout=10)
    if result.returncode != expected or value in result.stdout or value in result.stderr:
        raise SystemExit('FAIL database deployment transport policy')
print(f'PASS actual deployment policy: {len(valid)} strict TLS cases accepted; {len(invalid)} unsafe/malformed cases rejected; no network used')
