#!/usr/bin/env bash
set -euo pipefail
umask 077

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
environment="${DRAPIXAI_DEPLOY_ENV:-}"
expected_database="${DRAPIXAI_EXPECTED_DATABASE_NAME:-}"
change_approval="${DRAPIXAI_CHANGE_APPROVAL_ID:-}"
backup_root="${DRAPIXAI_BACKUP_DIR:-/var/backups/drapixai}"
evidence_root="${DRAPIXAI_MIGRATION_EVIDENCE_DIR:-$repo_root/runtime/launch-evidence/migrations}"

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
if [[ ! "$change_approval" =~ ^[A-Za-z0-9._:-]{8,128}$ ]]; then
  echo "Set DRAPIXAI_CHANGE_APPROVAL_ID to the approved change reference." >&2
  exit 2
fi
if [[ "$environment" == "production" && "${DRAPIXAI_MIGRATION_APPROVAL:-}" != "I_APPROVE_PRODUCTION_MIGRATION" ]]; then
  echo "Production requires DRAPIXAI_MIGRATION_APPROVAL=I_APPROVE_PRODUCTION_MIGRATION." >&2
  exit 2
fi
for command in pg_dump pg_restore psql sha256sum git npm; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 2
  }
done

actual_database="$(psql --dbname="$DATABASE_URL" --tuples-only --no-align --command "SELECT current_database();" | tr -d "[:space:]")"
if [[ "$actual_database" != "$expected_database" ]]; then
  echo "Connected database does not match DRAPIXAI_EXPECTED_DATABASE_NAME." >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_commit="$(git -C "$repo_root" rev-parse HEAD)"
run_dir="$evidence_root/${environment}-${timestamp}"
backup_dir="$backup_root/$environment"
backup_path="$backup_dir/pre-migration-${timestamp}-${release_commit:0:12}.dump"
mkdir -p "$run_dir" "$backup_dir"
chmod 700 "$run_dir" "$backup_dir"

echo "Creating verified PostgreSQL backup for $environment."
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup_path"
pg_restore --list "$backup_path" > "$run_dir/backup-contents.txt"
sha256sum "$backup_path" > "$run_dir/backup.sha256"

(
  cd "$repo_root"
  npm --prefix apps/api exec prisma migrate status -- --schema apps/api/prisma/schema.prisma
) > "$run_dir/status-before.txt" 2>&1

echo "Applying committed Prisma migrations."
(
  cd "$repo_root"
  npm --prefix apps/api run prisma:migrate:deploy
) > "$run_dir/migrate-deploy.txt" 2>&1

(
  cd "$repo_root"
  npm --prefix apps/api exec prisma migrate status -- --schema apps/api/prisma/schema.prisma
) > "$run_dir/status-after.txt" 2>&1

backup_sha="$(cut -d ' ' -f1 "$run_dir/backup.sha256")"
cat > "$run_dir/evidence.json" <<EOF
{
  "environment": "$environment",
  "database_name": "$actual_database",
  "change_approval": "$change_approval",
  "release_commit": "$release_commit",
  "started_at": "$timestamp",
  "completed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_path": "$backup_path",
  "backup_sha256": "$backup_sha",
  "backup_catalog_verified": true,
  "migration_command": "prisma migrate deploy",
  "migration_status": "PASS",
  "rollback_script": "deploy/scripts/restore-postgres-backup.sh"
}
EOF

echo "Migration completed. Evidence: $run_dir/evidence.json"
echo "Backup: $backup_path"
