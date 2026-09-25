#!/usr/bin/env bash
set -euo pipefail

# Exercise the actual shell entry point with a synthetic ss executable. This
# never scans a host, starts a service or changes any network configuration.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/drapixai-private-listeners.XXXXXX")"
cleanup() {
  rm -f "$work_dir/ss" "$work_dir/snapshot" "$work_dir/output"
  rmdir "$work_dir"
}
trap cleanup EXIT
cat > "$work_dir/ss" <<'STUB'
#!/usr/bin/env bash
[[ "$*" == '-H -lnt' ]] || exit 98
cat "$PRIVATE_LISTENER_FIXTURE"
exit "${PRIVATE_LISTENER_SS_EXIT:-0}"
STUB
chmod +x "$work_dir/ss"

count=0
check() {
  local label="$1" expected="$2" snapshot="$3"
  local ports="${4-__DEFAULT__}" allowed="${5-}" ss_exit="${6-0}" actual=0
  printf '%s\n' "$snapshot" > "$work_dir/snapshot"
  (
    export PATH="$work_dir:$PATH"
    export PRIVATE_LISTENER_FIXTURE="$work_dir/snapshot" PRIVATE_LISTENER_SS_EXIT="$ss_exit"
    export DRAPIXAI_PRIVATE_BIND_IPS="$allowed"
    if [[ "$ports" == __DEFAULT__ ]]; then
      unset DRAPIXAI_PRIVATE_PORTS
    else
      export DRAPIXAI_PRIVATE_PORTS="$ports"
    fi
    bash "$script_dir/verify-private-listeners.sh"
  ) > "$work_dir/output" 2>&1 || actual=$?
  if [[ "$actual" -ne "$expected" ]]; then
    echo "FAIL: $label (expected exit $expected, got $actual)" >&2
    cat "$work_dir/output" >&2
    exit 1
  fi
  if [[ "$expected" -ne 0 ]] && grep -q 'PASS:' "$work_dir/output"; then
    echo "FAIL: $label emitted a success claim while rejecting the snapshot." >&2
    cat "$work_dir/output" >&2
    exit 1
  fi
  if [[ "$expected" -eq 0 ]] && ! grep -q 'Host TCP listener verification passed' "$work_dir/output"; then
    echo "FAIL: $label did not complete verification." >&2
    exit 1
  fi
  count=$((count + 1))
  echo "PASS: $label"
}

for address in '127.0.0.1' '127.42.0.1' '[::1]' '::1' '[0:0:0:0:0:0:0:1]' '[::ffff:127.0.0.1]' '127.0.0.1%lo'; do
  check "loopback $address" 0 "LISTEN 0 128 $address:5432 *:*"
done
for address in '0.0.0.0' '[::]' '::' '*' '8.8.8.8' '[2606:4700:4700::1111]' '[::ffff:8.8.8.8]' '[::ffff:0.0.0.0]'; do
  check "reject unapproved $address" 1 "LISTEN 0 128 $address:5432 *:*"
done
for port in 5432 6379 8080 9000 9001 13000 18000 18080; do
  check "protect default port $port" 1 "LISTEN 0 128 8.8.8.8:$port 0.0.0.0:*"
done
for address in '10.20.0.4' '172.16.0.4' '192.168.2.4' '100.100.20.4' 'fd7a:115c:a1e0::4'; do
  check "reject implicit private bind $address" 1 "LISTEN 0 128 $address:5432 *:*"
  check "approve exact private bind $address" 0 "LISTEN 0 128 $address:5432 *:*" __DEFAULT__ "$address"
done
check 'IPv6 allowlist normalization' 0 'LISTEN 0 128 [fd7a:115c:a1e0::4]:6379 [::]:*' __DEFAULT__ 'fd7a:115c:a1e0:0:0:0:0:4'
check 'mapped private IPv4 normalization' 0 'LISTEN 0 128 [::ffff:10.20.0.4]:5432 *:*' __DEFAULT__ '10.20.0.4'
check 'allowlist does not approve another private IP' 1 'LISTEN 0 128 10.20.0.5:5432 *:*' __DEFAULT__ '10.20.0.4'
check 'loopback plus public bind cannot pass' 1 $'LISTEN 0 128 127.0.0.1:5432 *:*\nLISTEN 0 128 8.8.8.8:5432 *:*'
check 'unrelated public HTTPS is outside protected ports' 0 'LISTEN 0 128 0.0.0.0:443 0.0.0.0:*'
check 'empty snapshot has no host TCP listeners' 0 ''
check 'custom port is protected' 1 'LISTEN 0 128 8.8.8.8:12345 *:*' '12345'
check 'valid comma separated ports' 0 'LISTEN 0 128 [::1]:5432 *:*' '5432, 6379'
check 'ss failure with empty output' 2 '' __DEFAULT__ '' 1
check 'ss failure after valid output' 2 'LISTEN 0 128 127.0.0.1:5432 *:*' __DEFAULT__ '' 1

for ports in '' ' ' '5432,' ',5432' '5432,,6379' '5432,5432' '0' '65536' '9999999999999999999' '-1' '05432' '54 32' '5432x' '5432;6379'; do
  check "reject malformed ports [$ports]" 2 '' "$ports"
done
for allowed in '8.8.8.8' '2606:4700:4700::1111' '0.0.0.0' '::' '*' '10.20.0.0/16' '10.20.0.4,' ',10.20.0.4' 'localhost' '127.0.0.1' '169.254.1.1' 'fe80::1' '192.0.2.1' '10.20.0.4%eth0' '[fd00::1]' '999.2.3.4'; do
  check "reject invalid allowlist [$allowed]" 2 '' __DEFAULT__ "$allowed"
done
for snapshot in \
  'State Recv-Q Send-Q Local Address:Port Peer Address:Port' \
  'permission denied' \
  'tcp LISTEN 0 128 8.8.8.8:5432 *:*' \
  'LISTEN 0 128 127.0.0.1:5432' \
  'LISTEN 0 128 127.0.0.1:5432 *:* extra' \
  'ESTAB 0 128 127.0.0.1:5432 *:*' \
  'LISTEN bad 128 127.0.0.1:5432 *:*' \
  'LISTEN 0 -1 127.0.0.1:5432 *:*' \
  'LISTEN 0 128 hostname:5432 *:*' \
  'LISTEN 0 128 127.0.0.1:postgres *:*' \
  'LISTEN 0 128 127.0.0.1:0 *:*' \
  'LISTEN 0 128 127.0.0.1:65536 *:*' \
  'LISTEN 0 128 999.2.3.4:5432 *:*' \
  'LISTEN 0 128 [::1:5432 *:*' \
  'LISTEN 0 128 [127.0.0.1]:5432 *:*' \
  'LISTEN 0 128 [::gg]:5432 *:*' \
  'LISTEN 0 128 [::1%lo%extra]:5432 *:*' \
  'LISTEN 0 128 127.0.0.1:5432 peer:*' \
  'LISTEN 0 128 127.0.0.1:443 garbage'; do
  check "reject malformed row [$snapshot]" 2 "$snapshot"
done
check 'malformed row after valid listener cannot pass' 2 $'LISTEN 0 128 127.0.0.1:5432 *:*\ngarbage'
echo "Passed $count private listener verifier cases."
