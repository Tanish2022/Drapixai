#!/usr/bin/env bash
set -euo pipefail
umask 077

environment="${DRAPIXAI_DEPLOY_ENV:-}"
expected_database="${DRAPIXAI_EXPECTED_DATABASE_NAME:-}"
restore_approval="${DRAPIXAI_RESTORE_APPROVAL_ID:-}"
expected_backup_sha="${DRAPIXAI_EXPECTED_BACKUP_SHA256:-}"
backup_path="${1:-}"

if [[ -z "$backup_path" || ! -f "$backup_path" ]]; then
  echo "Usage: $0 /absolute/path/to/verified-backup.dump" >&2
  exit 2
fi
if [[ "$environment" != "sandbox" && "$environment" != "staging" && "$environment" != "production" ]]; then
  echo "Set DRAPIXAI_DEPLOY_ENV to sandbox, staging, or production." >&2
  exit 2
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required." >&2
  exit 2
fi
if [[ ! "$expected_database" =~ ^[A-Za-z0-9_]{1,63}$ ]]; then
  echo "Set DRAPIXAI_EXPECTED_DATABASE_NAME to the exact target database name." >&2
  exit 2
fi
if [[ ! "$restore_approval" =~ ^[A-Za-z0-9._:-]{8,128}$ ]]; then
  echo "Set DRAPIXAI_RESTORE_APPROVAL_ID to the incident or recovery approval reference." >&2
  exit 2
fi
expected="RESTORE_${environment^^}"
if [[ "${DRAPIXAI_RESTORE_CONFIRMATION:-}" != "$expected" ]]; then
  echo "Restore is destructive. Set DRAPIXAI_RESTORE_CONFIRMATION=$expected after the incident commander approves downtime." >&2
  exit 2
fi

if [[ ! "$expected_backup_sha" =~ ^[a-fA-F0-9]{64}$ ]]; then
  echo "Set DRAPIXAI_EXPECTED_BACKUP_SHA256 to the independently recorded expected backup SHA-256." >&2
  exit 2
fi
for command in psql pg_restore sha256sum env mktemp chmod stat id uname; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 2; }
done
backup_sha="$(sha256sum < "$backup_path")"
backup_sha="${backup_sha%% *}"
if [[ "$backup_sha" != "${expected_backup_sha,,}" ]]; then
  echo "Backup checksum does not match DRAPIXAI_EXPECTED_BACKUP_SHA256." >&2
  exit 1
fi
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/private-libpq.sh"
drapixai_prepare_libpq
actual_database="$(drapixai_private_pg psql --tuples-only --no-align --command "SELECT current_database();" | tr -d "[:space:]")"
if [[ "$actual_database" != "$expected_database" ]]; then
  echo "Connected database does not match DRAPIXAI_EXPECTED_DATABASE_NAME." >&2
  exit 1
fi

drapixai_private_pg pg_restore --list "$backup_path" >/dev/null
echo "Restoring the verified backup into $environment database $actual_database (approval: $restore_approval)."
drapixai_private_pg pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --single-transaction \
  --exit-on-error \
  "$backup_path"
echo "Restore completed. Run application readiness, tenant-isolation, and audit-chain verification before reopening traffic."
