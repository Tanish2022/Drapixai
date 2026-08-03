#!/usr/bin/env bash
set -euo pipefail

if ! command -v ss >/dev/null 2>&1; then
  echo "ss is required to verify listeners." >&2
  exit 2
fi

private_ports="${DRAPIXAI_PRIVATE_PORTS:-5432,6379,8080,9000,9001}"
listener_snapshot="$(ss -H -lnt)"
failures=0

IFS=',' read -r -a ports <<< "$private_ports"
for port in "${ports[@]}"; do
  port="${port//[[:space:]]/}"
  [[ "$port" =~ ^[0-9]+$ ]] || {
    echo "Invalid private port: $port" >&2
    exit 2
  }
  if printf '%s\n' "$listener_snapshot" | awk -v target=":$port" '
    $4 ~ target"$" && ($4 ~ /^0\.0\.0\.0:/ || $4 ~ /^\[::\]:/ || $4 ~ /^\*:/) { found=1 }
    END { exit found ? 0 : 1 }
  '; then
    echo "FAIL: private service port $port is listening on a public wildcard address." >&2
    failures=$((failures + 1))
  else
    echo "PASS: port $port is not bound to a public wildcard address."
  fi
done

if (( failures > 0 )); then
  echo "Private listener verification failed." >&2
  exit 1
fi

echo "Private listener verification passed. Confirm cloud firewall/security-group rules separately."
