#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  set -a; source /etc/drapixai/internal-proxy.env; set +a
  bash deploy/workstation/internal-proxy/verify-mtls-proxy.sh [rendered-config]

Run this on the GPU host after Nginx is reloaded. It verifies the AI origin is
loopback-only and the proxy is bound only to the declared VPN IP. It does not
replace an API-host client-certificate handshake test.
EOF
  exit 2
}

[[ $# -le 1 ]] || usage
for command in ss grep awk; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done

for name in DRAPIXAI_VPN_BIND_IP DRAPIXAI_INTERNAL_PROXY_PORT DRAPIXAI_AI_LOCAL_PORT; do
  [[ -n "${!name:-}" ]] || { echo "Missing required environment variable: $name" >&2; exit 2; }
done
config_path="${1:-/etc/nginx/conf.d/drapixai-ai-mtls.conf}"
[[ -f "$config_path" ]] || { echo "Missing rendered proxy configuration: $config_path" >&2; exit 1; }

grep -Fq "listen ${DRAPIXAI_VPN_BIND_IP}:${DRAPIXAI_INTERNAL_PROXY_PORT} ssl" "$config_path" || {
  echo "Proxy config is not bound to the declared VPN address and port." >&2
  exit 1
}
grep -Fq "ssl_verify_client on;" "$config_path" || { echo "Proxy config does not require client certificates." >&2; exit 1; }
grep -Fq "ssl_client_certificate " "$config_path" || { echo "Proxy config does not declare a client CA." >&2; exit 1; }
grep -Fq "proxy_pass http://127.0.0.1:${DRAPIXAI_AI_LOCAL_PORT};" "$config_path" || {
  echo "Proxy must forward only to the loopback AI API." >&2
  exit 1
}

listeners="$(ss -H -lnt)"
if ! printf '%s\n' "$listeners" | awk -v expected="${DRAPIXAI_VPN_BIND_IP}:${DRAPIXAI_INTERNAL_PROXY_PORT}" '$4 == expected { found=1 } END { exit found ? 0 : 1 }'; then
  echo "No TCP listener found on ${DRAPIXAI_VPN_BIND_IP}:${DRAPIXAI_INTERNAL_PROXY_PORT}." >&2
  exit 1
fi
if printf '%s\n' "$listeners" | awk -v port=":${DRAPIXAI_INTERNAL_PROXY_PORT}" '$4 ~ port"$" && ($4 ~ /^0\.0\.0\.0:/ || $4 ~ /^\[::\]:/) { found=1 } END { exit found ? 0 : 1 }'; then
  echo "mTLS proxy port is exposed on a wildcard address." >&2
  exit 1
fi
if printf '%s\n' "$listeners" | awk '$4 ~ /^0\.0\.0\.0:80$/ || $4 ~ /^\[::\]:80$/ { found=1 } END { exit found ? 0 : 1 }'; then
  echo "GPU host has a wildcard HTTP listener; disable the default Nginx site before launch." >&2
  exit 1
fi
if ! printf '%s\n' "$listeners" | awk -v port=":${DRAPIXAI_AI_LOCAL_PORT}" '$4 ~ port"$" && ($4 ~ /^127\.0\.0\.1:/ || $4 ~ /^\[::1\]:/) { found=1 } END { exit found ? 0 : 1 }'; then
  echo "AI origin must listen only on loopback port ${DRAPIXAI_AI_LOCAL_PORT}." >&2
  exit 1
fi

echo "PASS: GPU mTLS proxy requires client certificates on ${DRAPIXAI_VPN_BIND_IP}:${DRAPIXAI_INTERNAL_PROXY_PORT}."
echo "NEXT: from the API host, verify a request without a client certificate fails and one with the dedicated API client certificate succeeds."
