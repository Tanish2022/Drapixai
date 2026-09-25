#!/usr/bin/env bash
set -euo pipefail

# The edge host must bind protected ports to loopback by default. Separate data
# hosts may opt into exact private/VPN IPs with DRAPIXAI_PRIVATE_BIND_IPS, e.g.
# DRAPIXAI_PRIVATE_BIND_IPS=10.20.0.4,fd7a:115c:a1e0::4. Public IPs, CIDRs and
# wildcard addresses cannot be allowlisted. This checks host TCP listeners only;
# container forwarding, upstream firewalls and VPN ACLs require separate evidence.
[[ $# -eq 0 ]] || { echo "This verifier does not accept arguments." >&2; exit 2; }
for command in ss python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required to verify listeners." >&2
    exit 2
  }
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! listener_snapshot="$(ss -H -lnt)"; then
  echo "Unable to collect TCP listeners; verification failed." >&2
  exit 2
fi
printf '%s\n' "$listener_snapshot" | python3 "$script_dir/verify-private-listeners.py"
