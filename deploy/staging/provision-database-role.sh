#!/usr/bin/env bash
set -euo pipefail
set +x

[[ "${POSTGRES_USER:-}" == "drapixai_staging" && "${POSTGRES_DB:-}" == "drapixai_staging" ]] || {
  echo "Refusing runtime-role provisioning outside the dedicated staging database." >&2
  exit 2
}
password="$(cat /run/secrets/api_database_password)"
[[ "$password" =~ ^[A-Za-z0-9_-]{32,}$ ]] || {
  echo "Staging API database password must be a generated URL-safe secret." >&2
  exit 2
}

# Keep the password off command arguments and disable SQL echo in psql.
psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
\set ECHO none
BEGIN;
DO \$\$
BEGIN
  IF to_regclass('public."SecurityAuditLog"') IS NULL THEN
    RAISE EXCEPTION 'Apply all release migrations before provisioning the API role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drapixai_staging_api') THEN
    CREATE ROLE drapixai_staging_api;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relowner = 'drapixai_staging_api'::regrole
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner = 'drapixai_staging_api'::regrole
    UNION ALL SELECT 1 FROM pg_database WHERE datdba = 'drapixai_staging_api'::regrole
  ) THEN
    RAISE EXCEPTION 'API role owns database objects; transfer ownership through a reviewed migration first';
  END IF;
END
\$\$;
SELECT format('REVOKE %I FROM drapixai_staging_api', r.rolname)
FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
WHERE m.member = 'drapixai_staging_api'::regrole
\gexec
ALTER ROLE drapixai_staging_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '$password';
REVOKE ALL ON DATABASE drapixai_staging FROM PUBLIC;
REVOKE ALL ON DATABASE drapixai_staging FROM drapixai_staging_api;
GRANT CONNECT ON DATABASE drapixai_staging TO drapixai_staging_api;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM drapixai_staging_api;
GRANT USAGE ON SCHEMA public TO drapixai_staging_api;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM drapixai_staging_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO drapixai_staging_api;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM drapixai_staging_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO drapixai_staging_api;
ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO drapixai_staging_api;
ALTER DEFAULT PRIVILEGES FOR ROLE drapixai_staging IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO drapixai_staging_api;
REVOKE ALL ON TABLE public."SecurityAuditLog" FROM drapixai_staging_api;
GRANT SELECT, INSERT ON TABLE public."SecurityAuditLog" TO drapixai_staging_api;
DO \$\$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM drapixai_staging_api;
  END IF;
END
\$\$;
COMMIT;
SQL
unset password
echo "PASS: staging API role provisioned without administrative or audit-mutation privileges."
