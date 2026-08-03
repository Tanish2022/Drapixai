#!/usr/bin/env bash
set -euo pipefail
umask 077

environment="${DRAPIXAI_DEPLOY_ENV:-}"
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
expected="RESTORE_${environment^^}"
if [[ "${DRAPIXAI_RESTORE_CONFIRMATION:-}" != "$expected" ]]; then
  echo "Restore is destructive. Set DRAPIXAI_RESTORE_CONFIRMATION=$expected after the incident commander approves downtime." >&2
  exit 2
fi

pg_restore --list "$backup_path" >/dev/null
echo "Restoring the verified backup into the explicitly selected $environment database."
pg_restore \
  --dbname="$DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$backup_path"
echo "Restore completed. Run application readiness, tenant-isolation, and audit-chain verification before reopening traffic."
