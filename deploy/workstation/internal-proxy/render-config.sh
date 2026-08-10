#!/usr/bin/env bash
set -euo pipefail
umask 077

usage() {
  cat >&2 <<'EOF'
Usage:
  set -a; source /etc/drapixai/internal-proxy.env; set +a
  bash deploy/workstation/internal-proxy/render-config.sh [output-path]

Required environment variables:
  DRAPIXAI_VPN_BIND_IP          Exact Tailscale/WireGuard IPv4 address of GPU host
  DRAPIXAI_AI_INTERNAL_HOST     Private DNS name used by the API (for example ai.drapixai.internal)
  DRAPIXAI_INTERNAL_PROXY_PORT  Usually 443
  DRAPIXAI_AI_LOCAL_PORT        Loopback AI API port, usually 8080
  DRAPIXAI_MTLS_SERVER_CERT     GPU proxy server certificate path
  DRAPIXAI_MTLS_SERVER_KEY      GPU proxy server private-key path
  DRAPIXAI_MTLS_CLIENT_CA       CA certificate that signs the API client certificate

The renderer refuses wildcard or loopback proxy binding. It does not generate
keys. Issue separate server and API-client certificates from an offline/internal
CA and protect private keys with mode 0600.
EOF
  exit 2
}

[[ $# -le 1 ]] || usage

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
template="$repo_root/deploy/workstation/internal-proxy/drapixai-ai-mtls.conf.template"
output_path="${1:-/etc/nginx/conf.d/drapixai-ai-mtls.conf}"

require() {
  [[ -n "${!1:-}" ]] || { echo "Missing required environment variable: $1" >&2; exit 1; }
}

for name in \
  DRAPIXAI_VPN_BIND_IP \
  DRAPIXAI_AI_INTERNAL_HOST \
  DRAPIXAI_INTERNAL_PROXY_PORT \
  DRAPIXAI_AI_LOCAL_PORT \
  DRAPIXAI_MTLS_SERVER_CERT \
  DRAPIXAI_MTLS_SERVER_KEY \
  DRAPIXAI_MTLS_CLIENT_CA; do
  require "$name"
done

command -v python3 >/dev/null 2>&1 || { echo "python3 is required." >&2; exit 1; }
python3 - "$DRAPIXAI_VPN_BIND_IP" <<'PY'
import ipaddress
import sys

address = ipaddress.IPv4Address(sys.argv[1])
tailscale = ipaddress.IPv4Network("100.64.0.0/10")
if address.is_loopback or address.is_unspecified or not (address.is_private or address in tailscale):
    raise SystemExit("DRAPIXAI_VPN_BIND_IP must be a concrete private or Tailscale IPv4 address.")
PY
[[ "$DRAPIXAI_AI_INTERNAL_HOST" =~ ^[A-Za-z0-9.-]+$ && "$DRAPIXAI_AI_INTERNAL_HOST" == *.* ]] || {
  echo "DRAPIXAI_AI_INTERNAL_HOST must be a valid private DNS name." >&2
  exit 1
}
for port_name in DRAPIXAI_INTERNAL_PROXY_PORT DRAPIXAI_AI_LOCAL_PORT; do
  port="${!port_name}"
  [[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || {
    echo "$port_name must be a TCP port between 1 and 65535." >&2
    exit 1
  }
done
for certificate_path in "$DRAPIXAI_MTLS_SERVER_CERT" "$DRAPIXAI_MTLS_SERVER_KEY" "$DRAPIXAI_MTLS_CLIENT_CA"; do
  [[ -f "$certificate_path" ]] || { echo "Required certificate file is missing: $certificate_path" >&2; exit 1; }
done

command -v envsubst >/dev/null 2>&1 || {
  echo "envsubst is required; install gettext-base on Ubuntu." >&2
  exit 1
}
mkdir -p "$(dirname "$output_path")"
envsubst '${DRAPIXAI_VPN_BIND_IP} ${DRAPIXAI_AI_INTERNAL_HOST} ${DRAPIXAI_INTERNAL_PROXY_PORT} ${DRAPIXAI_AI_LOCAL_PORT} ${DRAPIXAI_MTLS_SERVER_CERT} ${DRAPIXAI_MTLS_SERVER_KEY} ${DRAPIXAI_MTLS_CLIENT_CA}' \
  < "$template" > "$output_path"
chmod 600 "$output_path"
echo "Rendered private mTLS proxy configuration: $output_path"
