#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
Usage:
  DRAPIXAI_MTLS_GPU_URL=https://drapixai-ai.staging.internal \
  DRAPIXAI_MTLS_CA_CERT=/run/secrets/drapixai-internal-ca.pem \
  DRAPIXAI_MTLS_CLIENT_CERT=/run/secrets/drapixai-ai-client.crt \
  DRAPIXAI_MTLS_CLIENT_KEY=/run/secrets/drapixai-ai-client.key \
  bash deploy/workstation/internal-proxy/verify-mtls-api-handshake.sh

Run this from the API host through the private VPN. It records only pass/fail
boundary evidence: a request without the API client certificate must fail, and
a request with the dedicated client certificate must return HTTP 200 from the
GPU health endpoint. Do not run it against a public endpoint or copy private
keys, request bodies, or curl diagnostics into release evidence.
EOF
  exit 2
}

[[ $# -eq 0 ]] || usage
for command in curl; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done

for name in DRAPIXAI_MTLS_GPU_URL DRAPIXAI_MTLS_CA_CERT DRAPIXAI_MTLS_CLIENT_CERT DRAPIXAI_MTLS_CLIENT_KEY; do
  [[ -n "${!name:-}" ]] || { echo "Missing required environment variable: $name" >&2; exit 2; }
done

base_url="${DRAPIXAI_MTLS_GPU_URL%/}"
[[ "$base_url" =~ ^https://[A-Za-z0-9._:-]+$ ]] || {
  echo "DRAPIXAI_MTLS_GPU_URL must be an HTTPS origin without a path." >&2
  exit 2
}
for certificate_path in "$DRAPIXAI_MTLS_CA_CERT" "$DRAPIXAI_MTLS_CLIENT_CERT" "$DRAPIXAI_MTLS_CLIENT_KEY"; do
  [[ -f "$certificate_path" && -r "$certificate_path" ]] || {
    echo "Required certificate file is missing or unreadable: $certificate_path" >&2
    exit 2
  }
done

health_url="$base_url/health"
common_curl=(
  --noproxy '*'
  --fail
  --silent
  --show-error
  --connect-timeout 5
  --max-time 15
  --cacert "$DRAPIXAI_MTLS_CA_CERT"
  --output /dev/null
)

# Nginx must terminate TLS before it can pass the request upstream. A successful
# no-certificate request proves this boundary is broken, regardless of body.
if curl "${common_curl[@]}" "$health_url" >/dev/null 2>&1; then
  echo "GPU mTLS boundary accepted a request without the API client certificate." >&2
  exit 1
fi
printf '%s\n' 'PASS: GPU mTLS no-client handshake was rejected.'

status="$(curl "${common_curl[@]}" --cert "$DRAPIXAI_MTLS_CLIENT_CERT" --key "$DRAPIXAI_MTLS_CLIENT_KEY" --write-out '%{http_code}' "$health_url")"
[[ "$status" == '200' ]] || {
  echo "GPU mTLS API-client request did not return HTTP 200." >&2
  exit 1
}
printf '%s\n' 'PASS: GPU mTLS API-client handshake returned HTTP 200.'
printf '%s\n' 'PASS: GPU mTLS end-to-end handshake boundary passed.'