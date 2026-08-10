#!/usr/bin/env bash
set -euo pipefail
umask 077

environment="${DRAPIXAI_DEPLOY_ENV:-}"
expected_database="${DRAPIXAI_EXPECTED_DATABASE_NAME:-}"
restore_approval="${DRAPIXAI_RESTORE_APPROVAL_ID:-}"
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

command -v psql >/dev/null || { echo "Missing required command: psql" >&2; exit 2; }
actual_database="$(psql --dbname="$DATABASE_URL" --tuples-only --no-align --command "SELECT current_database();" | tr -d "[:space:]")"
if [[ "$actual_database" != "$expected_database" ]]; then
  echo "Connected database does not match DRAPIXAI_EXPECTED_DATABASE_NAME." >&2
  exit 1
fi

pg_restore --list "$backup_path" >/dev/null
echo "Restoring the verified backup into $environment database $actual_database (approval: $restore_approval)."
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$backup_path"
echo "Restore completed. Run application readiness, tenant-isolation, and audit-chain verification before reopening traffic."
